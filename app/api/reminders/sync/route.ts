import { NextRequest, NextResponse } from 'next/server';
import { saveSyncedReminders, getSyncedReminders } from '@/lib/db';
import { ReminderTask } from '@/lib/types';

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
      } else if (body && Array.isArray(body.reminders)) {
        rawItems = body.reminders;
      } else if (body && typeof body === 'object') {
        rawItems = [body];
      }
    } else {
      // Plain text fallback (one task per line)
      const text = await req.text();
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

    if (!Array.isArray(rawItems)) {
      return NextResponse.json({ success: false, error: 'Expected an array of reminders' }, { status: 400 });
    }

    // Sanitize and normalize items into ReminderTask structure
    const sanitized: ReminderTask[] = rawItems
      .filter(item => {
        const title = typeof item === 'string' ? item : item?.title || item?.name;
        if (!title || typeof title !== 'string') return false;
        const lower = title.toLowerCase();
        return (
          !lower.includes('where are my reminders') &&
          !lower.includes('upgraded these reminders')
        );
      })
      .map(item => {
        const isString = typeof item === 'string';
        const title = isString ? item.trim() : (item.title || item.name || '').trim();
        const listName = isString ? 'Reminders' : (item.listName || item.list || 'Reminders').trim();
        const rawDue = isString ? undefined : (item.dueDate || item.due_date || item.due || item.deadline);
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

        const rawPrio = isString ? 0 : (item.priority ?? 0);
        let priority: 0 | 1 | 5 | 9 = 0;
        if (rawPrio === 1 || rawPrio === '1' || rawPrio === 'high' || rawPrio === 'HIGH') priority = 1;
        else if (rawPrio === 5 || rawPrio === '5') priority = 5;
        else if (rawPrio === 9 || rawPrio === '9') priority = 9;

        const uid = item.id || item.uid || generateTaskUid(title, listName);

        return {
          id: uid,
          uid,
          title,
          listName,
          isCompleted: Boolean(item.isCompleted || item.completed),
          priority,
          dueDate,
          notes: item.notes || item.description || undefined,
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
