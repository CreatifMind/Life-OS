import { NextRequest, NextResponse } from 'next/server';
import { saveSyncedReminders, getSyncedReminders, getPendingReminders, clearPendingReminders } from '@/lib/db';
import { ReminderTask } from '@/lib/types';
import { COOKIE_NAME, verifySessionToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

async function isAuthorizedSyncRequest(req: NextRequest): Promise<boolean> {
  const syncSecret = process.env.SYNC_SECRET;
  if (!syncSecret) {
    return process.env.NODE_ENV !== 'production';
  }

  const authHeader = req.headers.get('authorization');
  const querySecret = req.nextUrl.searchParams.get('secret');
  const headerSecret = req.headers.get('x-sync-secret');

  if (
    authHeader === `Bearer ${syncSecret}` ||
    querySecret === syncSecret ||
    headerSecret === syncSecret
  ) {
    return true;
  }

  // Also allow authenticated dashboard sessions
  const dashPass = process.env.DASHBOARD_PASSWORD;
  if (dashPass) {
    const cookie = req.cookies.get(COOKIE_NAME)?.value;
    if (await verifySessionToken(cookie, dashPass)) return true;
  }

  return false;
}

function generateTaskUid(title: string, listName: string): string {
  const clean = `${listName}-${title}`.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  return `task-${clean}`;
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isAuthorizedSyncRequest(req))) {
      return NextResponse.json({ success: false, error: 'Unauthorized sync request' }, { status: 401 });
    }

    const format = req.nextUrl.searchParams.get('format');
    const claim = req.nextUrl.searchParams.get('claim') === '1';

    if (format === 'lines') {
      const pending = await getPendingReminders();
      if (claim && pending.length > 0) {
        await clearPendingReminders(pending.map(p => p.uid || p.id).filter(Boolean));
      }
      const lines = pending
        .map(p => String(p.title || '').trim())
        .filter(Boolean)
        .join('\n');
      return new NextResponse(lines, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const [reminders, pendingReminders] = await Promise.all([
      getSyncedReminders(),
      getPendingReminders(),
    ]);
    const openTasks = reminders.filter(r => !r.isCompleted);
    const completedTasks = reminders.filter(r => r.isCompleted);

    return NextResponse.json({
      success: true,
      syncSnapshotAt: new Date().toISOString(),
      count: reminders.length,
      openCount: openTasks.length,
      completedCount: completedTasks.length,
      reminders,
      completedTitles: completedTasks.map(t => t.title),
      pendingReminders,
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
    if (!(await isAuthorizedSyncRequest(req))) {
      return NextResponse.json({ success: false, error: 'Unauthorized sync request' }, { status: 401 });
    }

    const contentType = req.headers.get('content-type') || '';
    let rawItems: any[] = [];
    let createdPendingUids: string[] = [];
    let syncSnapshotAt: string | undefined;
    let completedTitlesProcessed = new Set<string>();

    if (contentType.includes('application/json')) {
      const body = await req.json();
      if (Array.isArray(body)) {
        rawItems = body;
      } else if (body && typeof body === 'object') {
        if (Array.isArray(body.createdPendingUids)) {
          createdPendingUids = body.createdPendingUids.filter((u: any) => typeof u === 'string');
        }
        if (typeof body.syncSnapshotAt === 'string') {
          syncSnapshotAt = body.syncSnapshotAt;
        }
        if (Array.isArray(body.completedTitlesProcessed)) {
          completedTitlesProcessed = new Set(
            body.completedTitlesProcessed
              .filter((t: any) => typeof t === 'string')
              .map((t: string) => t.trim().toLowerCase())
          );
        }
        // Find reminders array property (excluding metadata arrays)
        const arrayEntry = Object.entries(body).find(
          ([k, v]) =>
            k !== 'createdPendingUids' &&
            k !== 'completedTitlesProcessed' &&
            Array.isArray(v)
        );
        if (arrayEntry && Array.isArray(arrayEntry[1])) {
          rawItems = arrayEntry[1];
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

    if (createdPendingUids.length > 0) {
      await clearPendingReminders(createdPendingUids);
    }

    // Preserve any still-pending Life OS reminders not yet pushed to Apple Reminders
    const remainingPending = await getPendingReminders();
    const seenTitles = new Set(sanitized.map(r => r.title.toLowerCase().trim()));
    for (const p of remainingPending) {
      const key = String(p.title || '').toLowerCase().trim();
      if (key && !seenTitles.has(key)) {
        sanitized.unshift(p);
        seenTitles.add(key);
      }
    }

    // Preserve any in-flight mobile check-offs made after syncSnapshotAt (between Step 1 GET and Step 5 POST)
    const currentSynced = await getSyncedReminders();
    const snapshotMs = syncSnapshotAt ? new Date(syncSnapshotAt).getTime() : Date.now() - 15000;
    const recentCompletions = new Map<string, string>();
    for (const existing of currentSynced) {
      if (existing.isCompleted && existing.completedAt) {
        const compMs = new Date(existing.completedAt).getTime();
        const key = String(existing.title || '').trim().toLowerCase();
        if (!isNaN(compMs) && compMs > snapshotMs && key && !completedTitlesProcessed.has(key)) {
          recentCompletions.set(key, existing.completedAt);
        }
      }
    }

    const merged = sanitized.map(item => {
      const key = item.title.trim().toLowerCase();
      const compAt = recentCompletions.get(key);
      if (compAt) {
        return { ...item, isCompleted: true, completedAt: compAt };
      }
      return item;
    });

    // Save to Supabase
    await saveSyncedReminders(merged);

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${merged.length} reminder(s) from Apple Shortcuts`,
      count: merged.length,
      syncedReminders: merged,
    });
  } catch (err: any) {
    console.error('Failed to sync reminders via webhook:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
