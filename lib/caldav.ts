/**
 * Life OS — CalDAV Integration Client
 * Directly synchronizes with Apple iCloud CalDAV (VEVENT & VTODO)
 */

import { CalendarEvent, ReminderTask } from './types';
import { getSyncedReminders, updateSyncedReminderStatus } from './db';

const APPLE_ID = process.env.APPLE_ID || '';
const APPLE_APP_SPECIFIC_PASSWORD = process.env.APPLE_APP_SPECIFIC_PASSWORD || '';

function getAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${APPLE_ID}:${APPLE_APP_SPECIFIC_PASSWORD.trim()}`).toString('base64');
}

async function davRequest(url: string, method: string, headers: Record<string, string> = {}, body: string | null = null) {
  const defaultHeaders = {
    'Authorization': getAuthHeader(),
    'User-Agent': 'LifeOS-CalDAV-Client/1.0',
    ...headers,
  };

  const res = await fetch(url, {
    method,
    headers: defaultHeaders,
    body: body || undefined,
    redirect: 'follow',
  });

  const text = await res.text();
  return { status: res.status, url: res.url, headers: res.headers, text };
}

function extractInnerHref(xml: string, containerTag: string): string | null {
  const containerRegex = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${containerTag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${containerTag}>`, 'i');
  const containerMatch = containerRegex.exec(xml);
  if (!containerMatch) return null;
  const hrefMatch = /<(?:[a-zA-Z0-9_-]+:)?href[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?href>/i.exec(containerMatch[1]);
  return hrefMatch ? hrefMatch[1].trim() : null;
}

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

let cachedCollections: {
  calendars: Array<{ name: string; url: string }>;
  reminderLists: Array<{ name: string; url: string }>;
  timestamp: number;
} | null = null;

export async function discoverCollections() {
  if (cachedCollections && Date.now() - cachedCollections.timestamp < 1000 * 60 * 30) {
    return cachedCollections;
  }

  // 1. Principal discovery
  const principalBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal /></d:prop>
</d:propfind>`;

  const pRes = await davRequest('https://caldav.icloud.com/', 'PROPFIND', {
    'Depth': '0',
    'Content-Type': 'application/xml; charset=utf-8',
  }, principalBody);

  if (pRes.status >= 400) {
    throw new Error(`iCloud authentication failed (HTTP ${pRes.status}). Verify APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD.`);
  }

  const userPartition = pRes.headers.get('x-apple-user-partition');
  const clusterHost = userPartition ? `https://p${userPartition}-caldav.icloud.com` : 'https://caldav.icloud.com';

  const principalHref = extractInnerHref(pRes.text, 'current-user-principal');
  if (!principalHref) throw new Error('Could not parse current-user-principal.');
  const principalUrl = resolveUrl(clusterHost, principalHref);

  // 2. Calendar Home Set discovery
  const homeBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set /></d:prop>
</d:propfind>`;

  const hRes = await davRequest(principalUrl, 'PROPFIND', {
    'Depth': '0',
    'Content-Type': 'application/xml; charset=utf-8',
  }, homeBody);

  const homeHref = extractInnerHref(hRes.text, 'calendar-home-set');
  if (!homeHref) throw new Error('Could not locate calendar-home-set.');
  const homeUrl = resolveUrl(clusterHost, homeHref);

  // 3. Enumerating collections
  const collectionsBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <c:supported-calendar-component-set />
  </d:prop>
</d:propfind>`;

  const colRes = await davRequest(homeUrl, 'PROPFIND', {
    'Depth': '1',
    'Content-Type': 'application/xml; charset=utf-8',
  }, collectionsBody);

  const responseBlocks = [...colRes.text.matchAll(/<response[\s\S]*?<\/response>/gi)];
  const calendars: Array<{ name: string; url: string }> = [];
  const reminderLists: Array<{ name: string; url: string }> = [];

  for (const match of responseBlocks) {
    const raw = match[0];
    const hrefMatch = /<href[^>]*>(.*?)<\/href>/i.exec(raw);
    const nameMatch = /<displayname[^>]*>(.*?)<\/displayname>/i.exec(raw);
    if (!hrefMatch) continue;

    const href = hrefMatch[1].trim();
    const cleanHref = href.replace(/\/+$/, '');
    const cleanHomeHref = homeHref.replace(/\/+$/, '');
    if (cleanHref === cleanHomeHref || href.endsWith('/inbox/') || href.endsWith('/outbox/')) continue;

    const name = nameMatch ? nameMatch[1].trim() : 'Untitled';
    const supportsEvent = /VEVENT/i.test(raw);
    const supportsTodo = /VTODO/i.test(raw);
    const fullColUrl = resolveUrl(homeUrl, href);

    if (supportsEvent && !supportsTodo) {
      calendars.push({ name, url: fullColUrl });
    } else if (supportsTodo) {
      reminderLists.push({ name, url: fullColUrl });
    }
  }

  cachedCollections = { calendars, reminderLists, timestamp: Date.now() };
  return cachedCollections;
}

export async function fetchLiveCalendarEvents(daysPast = 14, daysFuture = 30): Promise<CalendarEvent[]> {
  const { calendars } = await discoverCollections();
  const allEvents: CalendarEvent[] = [];

  const now = new Date();
  const startRange = new Date(now.getTime() - daysPast * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const endRange = new Date(now.getTime() + daysFuture * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  for (const cal of calendars) {
    const reportBody = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag /><c:calendar-data /></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${startRange}" end="${endRange}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

    const res = await davRequest(cal.url, 'REPORT', {
      'Depth': '1',
      'Content-Type': 'application/xml; charset=utf-8',
    }, reportBody);

    const eventBlocks = [...res.text.matchAll(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi)];
    for (const eb of eventBlocks) {
      const v = eb[0];
      const uidMatch = /UID:(.*)/i.exec(v);
      const summaryMatch = /SUMMARY:(.*)/i.exec(v);
      const dtStartMatch = /DTSTART(?:;[^:]+)?:(.*)/i.exec(v);
      const dtEndMatch = /DTEND(?:;[^:]+)?:(.*)/i.exec(v);
      const locMatch = /LOCATION:(.*)/i.exec(v);
      const descMatch = /DESCRIPTION:(.*)/i.exec(v);

      if (!summaryMatch) continue;

      const rawStart = dtStartMatch ? dtStartMatch[1].trim() : new Date().toISOString();
      const rawEnd = dtEndMatch ? dtEndMatch[1].trim() : rawStart;

      allEvents.push({
        id: uidMatch ? uidMatch[1].trim() : `event-${Math.random()}`,
        title: summaryMatch[1].trim(),
        calendarName: cal.name,
        startTime: parseIcsDate(rawStart),
        endTime: parseIcsDate(rawEnd),
        isAllDay: rawStart.length === 8, // YYYYMMDD
        location: locMatch ? locMatch[1].trim() : undefined,
        description: descMatch ? descMatch[1].trim() : undefined,
      });
    }
  }

  return allEvents.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

export async function fetchLiveReminders(): Promise<ReminderTask[]> {
  // 1. Fetch synced reminders from Supabase (from Apple Shortcuts webhook)
  let syncedTasks: ReminderTask[] = [];
  try {
    syncedTasks = await getSyncedReminders();
  } catch (err) {
    console.warn('Could not load synced reminders from db:', err);
  }

  const allTasks: ReminderTask[] = [...syncedTasks];
  const seenTitles = new Set(syncedTasks.map(t => t.title.toLowerCase().trim()));

  // 2. Fetch direct CalDAV tasks (if any)
  try {
    const { reminderLists } = await discoverCollections();

    for (const list of reminderLists) {
      const reportBody = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag /><c:calendar-data /></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO" />
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

      const res = await davRequest(list.url, 'REPORT', {
        'Depth': '1',
        'Content-Type': 'application/xml; charset=utf-8',
      }, reportBody);

      const todoBlocks = [...res.text.matchAll(/BEGIN:VTODO[\s\S]*?END:VTODO/gi)];
      for (const tb of todoBlocks) {
        const v = tb[0];
        const uidMatch = /UID:(.*)/i.exec(v);
        const summaryMatch = /SUMMARY:(.*)/i.exec(v);
        const statusMatch = /STATUS:(.*)/i.exec(v);
        const priorityMatch = /PRIORITY:(.*)/i.exec(v);
        const dueMatch = /DUE(?:;[^:]+)?:(.*)/i.exec(v);
        const completedMatch = /COMPLETED(?:;[^:]+)?:(.*)/i.exec(v);
        const descMatch = /DESCRIPTION:(.*)/i.exec(v);

        if (!summaryMatch) continue;

        const rawTitle = summaryMatch[1].trim();
        const lower = rawTitle.toLowerCase();
        // Filter out Apple CloudKit legacy migration placeholder strings
        if (lower.includes('where are my reminders') || lower.includes('upgraded these reminders')) {
          continue;
        }

        if (seenTitles.has(lower)) {
          continue;
        }

        const uid = uidMatch ? uidMatch[1].trim() : `task-${Math.random()}`;
        const status = statusMatch ? statusMatch[1].trim().toUpperCase() : 'NEEDS-ACTION';
        const isCompleted = status === 'COMPLETED';

        const prioRaw = priorityMatch ? parseInt(priorityMatch[1].trim(), 10) : 0;
        let priority: 0 | 1 | 5 | 9 = 0;
        if (prioRaw === 1) priority = 1;
        else if (prioRaw === 5) priority = 5;
        else if (prioRaw === 9) priority = 9;

        allTasks.push({
          id: uid,
          uid,
          title: summaryMatch[1].trim(),
          listName: list.name,
          isCompleted,
          priority,
          dueDate: dueMatch ? parseIcsDate(dueMatch[1].trim()) : undefined,
          completedAt: completedMatch ? parseIcsDate(completedMatch[1].trim()) : undefined,
          notes: descMatch ? descMatch[1].trim() : undefined,
        });
        seenTitles.add(lower);
      }
    }
  } catch (err) {
    console.warn('CalDAV reminders fetch error:', err);
  }

  return allTasks;
}

export async function createAppleReminder(title: string, listName?: string, dueDate?: string, notes?: string): Promise<string> {
  const { reminderLists } = await discoverCollections();
  const targetList = (listName && reminderLists.find(l => l.name.toLowerCase() === listName.toLowerCase())) || reminderLists[0];
  if (!targetList) throw new Error('No Apple Reminders list found.');

  const testUid = `lifeos-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const itemUrl = targetList.url.endsWith('/') ? `${targetList.url}${testUid}.ics` : `${targetList.url}/${testUid}.ics`;
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  let vtodo = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//LifeOS//CalDAV//EN
BEGIN:VTODO
UID:${testUid}
DTSTAMP:${timestamp}
SUMMARY:${title}
STATUS:NEEDS-ACTION
`;

  if (dueDate) {
    const formattedDue = new Date(dueDate).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    vtodo += `DUE:${formattedDue}\n`;
  }
  if (notes) {
    vtodo += `DESCRIPTION:${notes.replace(/\n/g, '\\n')}\n`;
  }

  vtodo += `END:VTODO\nEND:VCALENDAR`;

  const res = await davRequest(itemUrl, 'PUT', {
    'Content-Type': 'text/calendar; charset=utf-8',
  }, vtodo);

  if (res.status !== 201 && res.status !== 204 && res.status !== 200) {
    throw new Error(`Failed to create reminder: HTTP ${res.status}`);
  }

  return testUid;
}

export async function markAppleReminderComplete(taskUid: string, isCompleted: boolean = true, title?: string): Promise<void> {
  // 1. Update in Supabase synced reminders cache
  try {
    await updateSyncedReminderStatus(taskUid, isCompleted);
  } catch (err) {
    console.warn('Could not update synced reminder status in db:', err);
  }

  // 2. Also attempt CalDAV update if a CalDAV collection exists
  try {
    const { reminderLists } = await discoverCollections();
    const targetList = reminderLists[0];
    if (!targetList) return;

    const itemUrl = targetList.url.endsWith('/') ? `${targetList.url}${taskUid}.ics` : `${targetList.url}/${taskUid}.ics`;
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    // Fetch existing ICS to preserve the original task title and metadata
    const existing = await davRequest(itemUrl, 'GET');
    let vtodo = '';

    if (existing.status === 200 && existing.text.includes('BEGIN:VTODO')) {
      vtodo = existing.text;
      if (vtodo.includes('STATUS:')) {
        vtodo = vtodo.replace(/STATUS:[^\r\n]*/i, `STATUS:${isCompleted ? 'COMPLETED' : 'NEEDS-ACTION'}`);
      } else {
        vtodo = vtodo.replace(/END:VTODO/i, `STATUS:${isCompleted ? 'COMPLETED' : 'NEEDS-ACTION'}\nEND:VTODO`);
      }

      if (isCompleted) {
        if (vtodo.includes('COMPLETED:')) {
          vtodo = vtodo.replace(/COMPLETED:[^\r\n]*/i, `COMPLETED:${timestamp}`);
        } else {
          vtodo = vtodo.replace(/END:VTODO/i, `COMPLETED:${timestamp}\nEND:VTODO`);
        }
      } else {
        vtodo = vtodo.replace(/COMPLETED:[^\r\n]*[\r\n]*/i, '');
      }
    } else {
      vtodo = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//LifeOS//CalDAV//EN
BEGIN:VTODO
UID:${taskUid}
DTSTAMP:${timestamp}
SUMMARY:${title || 'Task'}
STATUS:${isCompleted ? 'COMPLETED' : 'NEEDS-ACTION'}
${isCompleted ? `COMPLETED:${timestamp}\n` : ''}END:VTODO
END:VCALENDAR`;
    }

    await davRequest(itemUrl, 'PUT', {
      'Content-Type': 'text/calendar; charset=utf-8',
    }, vtodo);
  } catch (davErr) {
    console.warn('CalDAV mark complete error (normal if using upgraded Reminders):', davErr);
  }
}

const DEFAULT_TIMEZONE_OFFSET = process.env.TIMEZONE_OFFSET || '+08:00';

function parseIcsDate(str: string): string {
  try {
    const cleaned = str.trim();
    if (cleaned.length === 8) { // YYYYMMDD
      const y = cleaned.substring(0, 4);
      const m = cleaned.substring(4, 6);
      const d = cleaned.substring(6, 8);
      return `${y}-${m}-${d}T00:00:00${DEFAULT_TIMEZONE_OFFSET}`;
    }
    const y = cleaned.substring(0, 4);
    const m = cleaned.substring(4, 6);
    const d = cleaned.substring(6, 8);
    const h = cleaned.substring(9, 11) || '00';
    const min = cleaned.substring(11, 13) || '00';
    const s = cleaned.substring(13, 15) || '00';
    if (cleaned.endsWith('Z')) {
      return `${y}-${m}-${d}T${h}:${min}:${s}.000Z`;
    }
    return `${y}-${m}-${d}T${h}:${min}:${s}${DEFAULT_TIMEZONE_OFFSET}`;
  } catch {
    return new Date().toISOString();
  }
}
