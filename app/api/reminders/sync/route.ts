import { NextRequest, NextResponse } from 'next/server';
import { saveSyncedReminders, getSyncedReminders } from '@/lib/db';
import { ReminderTask } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

function generateTaskUid(title: string, listName: string): string {
  const clean = `${listName}-${title}`.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  return `task-${clean}`;
}

export async function GET() {
  try {
    const reminders = await getSyncedReminders();
    const openTasks = reminders.filter(r => !r.isCompleted);
    const completedTasks = reminders.filter(r => r.isCompleted);

    return NextResponse.json({
      success: true,
      count: reminders.length,
      openCount: openTasks.length,
      completedCount: completedTasks.length,
      reminders,
      completedTitles: completedTasks.map(t => t.title),
      instructions: {
        method: 'POST',
        endpoint: '/api/reminders/sync',
        description: 'Send uncompleted reminders from Apple Shortcuts to display in Life OS',
        examplePayload: [
          {
            title: 'apple music',
            dueDate: '2026-11-18T20:00:00',
            listName: 'Reminders',
            priority: 0,
          },
        ],
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let rawItems: any[] = [];

    if (contentType.includes('application/json')) {
      const body = await req.json();
      if (Array.isArray(body)) {
        rawItems = body;
      } else if (body && typeof body === 'object') {
        // Find any array property (reminders, Reminders, tasks, Tasks, items, data, etc.)
        const arrayProp = Object.values(body).find(v => Array.isArray(v));
        if (arrayProp && Array.isArray(arrayProp)) {
          rawItems = arrayProp;
        } else {
          rawItems = [body];
        }
      }
    } else {
      // Plain text fallback (JSON string or one task per line)
      const text = await req.text();
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          rawItems = parsed;
        } else if (typeof parsed === 'object') {
          const arr = Object.values(parsed).find(v => Array.isArray(v));
          rawItems = Array.isArray(arr) ? arr : [parsed];
        }
      } catch {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        rawItems = lines.map(line => {
          const parts = line.split('|').map(p => p.trim());
          return {
            title: parts[0],
            dueDate: parts[1] || undefined,
            listName: parts[2] || 'Reminders',
          };
        });
      }
    }

    if (!Array.isArray(rawItems)) {
      return NextResponse.json({ success: false, error: 'Expected an array of reminders' }, { status: 400 });
    }

    // Sanitize and normalize items into ReminderTask structure
    const sanitized: ReminderTask[] = rawItems
      .filter(item => {
        if (!item) return false;
        const title = typeof item === 'string'
          ? item
          : item.title || item.Title || item.name || item.Name || item.summary || item.Summary;
        if (!title || typeof title !== 'string') return false;
        const lower = title.toLowerCase();
        return (
          !lower.includes('where are my reminders') &&
          !lower.includes('upgraded these reminders')
        );
      })
      .map(item => {
        const isString = typeof item === 'string';
        const title = isString
          ? item.trim()
          : (item.title || item.Title || item.name || item.Name || item.summary || item.Summary || '').trim();
        const listName = isString
          ? 'Reminders'
          : (item.listName || item.list || item.List || item['List Name'] || 'Reminders').trim();
        const rawDue = isString
          ? undefined
          : (item.dueDate || item.due_date || item['Due Date'] || item.Due || item.due || item.deadline);

        let dueDate: string | undefined;
        if (rawDue) {
          try {
            const d = new Date(rawDue);
            if (!isNaN(d.getTime())) {
              dueDate = d.toISOString();
            }
          } catch {
            // Keep undefined
          }
        }

        const rawPrio = isString ? 0 : (item.priority ?? item.Priority ?? 0);
        let priority: 0 | 1 | 5 | 9 = 0;
        if (rawPrio === 1 || rawPrio === '1' || rawPrio === 'high' || rawPrio === 'HIGH') priority = 1;
        else if (rawPrio === 5 || rawPrio === '5') priority = 5;
        else if (rawPrio === 9 || rawPrio === '9') priority = 9;

        const uid = (!isString && (item.id || item.uid || item.UID)) || generateTaskUid(title, listName);

        return {
          id: uid,
          uid,
          title,
          listName,
          isCompleted: Boolean(!isString && (item.isCompleted || item.completed || item['Is Completed'] || item.Completed)),
          priority,
          dueDate,
          notes: !isString ? (item.notes || item.Notes || item.description || item.Description || undefined) : undefined,
        };
      });

    // Save to Supabase
    await saveSyncedReminders(sanitized);

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${sanitized.length} reminder(s) from Apple Shortcuts`,
      count: sanitized.length,
      syncedReminders: sanitized,
    });
  } catch (err: any) {
    console.error('Failed to sync reminders via webhook:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
