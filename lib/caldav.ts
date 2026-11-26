/**
 * Life OS — CalDAV Integration Client
 * Directly synchronizes with Apple iCloud CalDAV (VEVENT & VTODO)
 */

import { CalendarEvent, ReminderTask } from './types';
import { getSyncedReminders, updateSyncedReminderStatus } from './db';

const APPLE_ID = process.env.APPLE_ID || '';
const APPLE_APP_SPECIFIC_PASSWORD = process.env.APPLE_APP_SPECIFIC_PASSWORD || '';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kuala_Lumpur';
const DEFAULT_TIMEZONE_OFFSET = process.env.TIMEZONE_OFFSET || '+08:00';

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
    signal: AbortSignal.timeout(10000),
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

  const responseBlocks = [...colRes.text.matchAll(/<(?:[a-zA-Z0-9_-]+:)?response[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?response>/gi)];
  const calendars: Array<{ name: string; url: string }> = [];
  const reminderLists: Array<{ name: string; url: string }> = [];

  for (const match of responseBlocks) {
    const raw = match[0];
    const hrefMatch = /<(?:[a-zA-Z0-9_-]+:)?href[^>]*>(.*?)<\/(?:[a-zA-Z0-9_-]+:)?href>/i.exec(raw);
    const nameMatch = /<(?:[a-zA-Z0-9_-]+:)?displayname[^>]*>(.*?)<\/(?:[a-zA-Z0-9_-]+:)?displayname>/i.exec(raw);
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

function unfoldIcs(raw: string): string {
  return raw.replace(/\r?\n[ \t]/g, '');
}

function stripValarm(raw: string): string {
  return raw.replace(/BEGIN:VALARM[\s\S]*?END:VALARM/gi, '');
}

function unescapeIcs(str: string): string {
  return str
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function formatYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shiftYmdDays(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + deltaDays));
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function getOffsetForTimeZone(tzid: string, year: number, month: number, day: number, hour: number, minute: number, second: number): string {
  try {
    const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      timeZoneName: 'shortOffset',
    }).formatToParts(approxUtc);
    const gmtLabel = parts.find(p => p.type === 'timeZoneName')?.value || '';
    if (gmtLabel === 'GMT' || gmtLabel === 'UTC') return '+00:00';
    const m = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(gmtLabel);
    if (m) {
      return `${m[1]}${m[2].padStart(2, '0')}:${(m[3] || '00').padStart(2, '0')}`;
    }
  } catch {}
  return DEFAULT_TIMEZONE_OFFSET;
}

function parseIcsDate(rawValue: string, rawParams: string = ''): { iso: string; isAllDay: boolean; ymd?: string } {
  try {
    const cleaned = rawValue.trim();
    const isDateValue = /VALUE=DATE/i.test(rawParams) || /^\d{8}$/.test(cleaned);
    if (isDateValue && cleaned.length >= 8) {
      const y = cleaned.substring(0, 4);
      const m = cleaned.substring(4, 6);
      const d = cleaned.substring(6, 8);
      const ymd = `${y}-${m}-${d}`;
      return {
        iso: `${ymd}T00:00:00${DEFAULT_TIMEZONE_OFFSET}`,
        isAllDay: true,
        ymd,
      };
    }

    const y = Number(cleaned.substring(0, 4));
    const m = Number(cleaned.substring(4, 6));
    const d = Number(cleaned.substring(6, 8));
    const h = Number(cleaned.substring(9, 11) || '0');
    const min = Number(cleaned.substring(11, 13) || '0');
    const s = Number(cleaned.substring(13, 15) || '0');

    const pad = (n: number) => String(n).padStart(2, '0');
    const ymd = formatYmd(y, m, d);

    if (cleaned.endsWith('Z')) {
      return {
        iso: `${ymd}T${pad(h)}:${pad(min)}:${pad(s)}.000Z`,
        isAllDay: false,
      };
    }

    const tzMatch = /TZID=([^;:]+)/i.exec(rawParams);
    const offset = tzMatch
      ? getOffsetForTimeZone(tzMatch[1].trim().replace(/^"|"$/g, ''), y, m, d, h, min, s)
      : DEFAULT_TIMEZONE_OFFSET;

    const parsedDate = new Date(`${ymd}T${pad(h)}:${pad(min)}:${pad(s)}${offset}`);
    return {
      iso: isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString(),
      isAllDay: false,
    };
  } catch {
    return { iso: new Date().toISOString(), isAllDay: false };
  }
}

export async function fetchLiveCalendarEvents(daysPast = 14, daysFuture = 60): Promise<CalendarEvent[]> {
  const { calendars } = await discoverCollections();

  const now = new Date();
  const startRange = new Date(now.getTime() - daysPast * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const endRange = new Date(now.getTime() + daysFuture * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const reportBody = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data>
      <c:expand start="${startRange}" end="${endRange}" />
    </c:calendar-data>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${startRange}" end="${endRange}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  const results = await Promise.allSettled(
    calendars.map(async cal => {
      const res = await davRequest(cal.url, 'REPORT', {
        'Depth': '1',
        'Content-Type': 'application/xml; charset=utf-8',
      }, reportBody);

      const events: CalendarEvent[] = [];
      const eventBlocks = [...res.text.matchAll(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi)];
      for (const eb of eventBlocks) {
        const cleanedBlock = stripValarm(unfoldIcs(eb[0]));
        const uidMatch = /^UID:([^\r\n]+)/im.exec(cleanedBlock);
        const summaryMatch = /^SUMMARY(?:;[^:]+)?:([^\r\n]+)/im.exec(cleanedBlock);
        const dtStartMatch = /^DTSTART(;[^:]+)?:([^\r\n]+)/im.exec(cleanedBlock);
        const dtEndMatch = /^DTEND(;[^:]+)?:([^\r\n]+)/im.exec(cleanedBlock);
        const locMatch = /^LOCATION(?:;[^:]+)?:([^\r\n]+)/im.exec(cleanedBlock);
        const descMatch = /^DESCRIPTION(?:;[^:]+)?:([^\r\n]+)/im.exec(cleanedBlock);
        const recurrenceMatch = /^RECURRENCE-ID(?:;[^:]+)?:([^\r\n]+)/im.exec(cleanedBlock);
        const rruleMatch = /^RRULE:([^\r\n]+)/im.exec(cleanedBlock);

        if (!summaryMatch) continue;

        const baseUid = uidMatch ? uidMatch[1].trim() : `event-${Math.random()}`;
        const recurrenceId = recurrenceMatch ? recurrenceMatch[1].trim() : '';
        const isRecurring = Boolean(recurrenceId || rruleMatch);
        const id = isRecurring && recurrenceId ? `${baseUid}::${recurrenceId}` : baseUid;

        const startParsed = dtStartMatch
          ? parseIcsDate(dtStartMatch[2], dtStartMatch[1] || '')
          : { iso: new Date().toISOString(), isAllDay: false };
        const endParsed = dtEndMatch
          ? parseIcsDate(dtEndMatch[2], dtEndMatch[1] || '')
          : startParsed;

        let startDate: string | undefined;
        let endDate: string | undefined;
        if (startParsed.isAllDay && startParsed.ymd) {
          startDate = startParsed.ymd;
          const exclusiveEndYmd = endParsed.ymd || shiftYmdDays(startDate, 1);
          endDate = exclusiveEndYmd > startDate ? shiftYmdDays(exclusiveEndYmd, -1) : startDate;
        }

        events.push({
          id,
          title: unescapeIcs(summaryMatch[1].trim()),
          calendarName: cal.name,
          startTime: startParsed.iso,
          endTime: endParsed.iso,
          startDate,
          endDate,
          isAllDay: startParsed.isAllDay,
          isRecurring,
          location: locMatch ? unescapeIcs(locMatch[1].trim()) : undefined,
          description: descMatch ? unescapeIcs(descMatch[1].trim()) : undefined,
        });
      }
      return events;
    })
  );

  const allEvents: CalendarEvent[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      allEvents.push(...r.value);
    }
  }

  return allEvents.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

export async function fetchLiveReminders(): Promise<ReminderTask[]> {
  try {
    return await getSyncedReminders();
  } catch (err) {
    console.warn('Could not load synced reminders from db:', err);
    return [];
  }
}

export async function markAppleReminderComplete(taskUid: string, isCompleted: boolean = true, _title?: string): Promise<void> {
  await updateSyncedReminderStatus(taskUid, isCompleted);
}

function toUtcIcsTimestamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function toMytYmd(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function addOneDayCompact(ymd: string): string {
  return shiftYmdDays(ymd, 1).replace(/-/g, '');
}

function isWritableCalendar(cal: { name: string }): boolean {
  const lower = cal.name.toLowerCase();
  return !lower.includes('holiday') && !lower.includes('birthday') && !lower.includes('siri');
}

export async function createAppleCalendarEvent(input: {
  title: string;
  startTime: string;
  endTime: string;
  startDate?: string;
  endDate?: string;
  isAllDay?: boolean;
  location?: string;
  description?: string;
  calendarName?: string;
}): Promise<CalendarEvent> {
  const { calendars } = await discoverCollections();
  if (calendars.length === 0) {
    throw new Error('No writable Apple Calendar found.');
  }

  const writableCalendars = calendars.filter(isWritableCalendar);
  const pool = writableCalendars.length > 0 ? writableCalendars : calendars;

  const isMeetingLike = /\b(meeting|call|sync|client|review|standup|interview|expo|fair|presentation)\b/i.test(input.title);
  const isPersonalLike = /\b(badminton|gym|workout|run|pickleball|football|dinner|lunch|movie|hangout|date|party|haircut|dentist|doctor|clinic|family|friends)\b/i.test(input.title);
  const preferredDefault = isPersonalLike ? 'personal' : isMeetingLike ? 'work' : 'personal';

  const targetCal =
    (input.calendarName && pool.find(c => c.name.toLowerCase() === input.calendarName!.toLowerCase())) ||
    pool.find(c => c.name.toLowerCase() === preferredDefault) ||
    pool.find(c => c.name.toLowerCase() === 'personal' || c.name.toLowerCase() === 'home' || c.name.toLowerCase() === 'work') ||
    pool[0];

  const uid = `lifeos-evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const itemUrl = targetCal.url.endsWith('/') ? `${targetCal.url}${uid}.ics` : `${targetCal.url}/${uid}.ics`;
  const dtstamp = toUtcIcsTimestamp(new Date().toISOString());

  const escapeIcs = (str: string) =>
    str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  let dtLines = '';
  let resolvedStartDate: string | undefined;
  let resolvedEndDate: string | undefined;
  let returnStartIso = '';
  let returnEndIso = '';

  if (input.isAllDay) {
    if (input.startDate && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) {
      resolvedStartDate = input.startDate;
      resolvedEndDate =
        input.endDate && /^\d{4}-\d{2}-\d{2}$/.test(input.endDate) && input.endDate >= resolvedStartDate
          ? input.endDate
          : resolvedStartDate;
      const exclusiveEndCompact = addOneDayCompact(resolvedEndDate);
      const exclusiveEndYmd = shiftYmdDays(resolvedEndDate, 1);
      dtLines = `DTSTART;VALUE=DATE:${resolvedStartDate.replace(/-/g, '')}\r\nDTEND;VALUE=DATE:${exclusiveEndCompact}`;
      returnStartIso = `${resolvedStartDate}T00:00:00${DEFAULT_TIMEZONE_OFFSET}`;
      returnEndIso = `${exclusiveEndYmd}T00:00:00${DEFAULT_TIMEZONE_OFFSET}`;
    } else {
      const startYmd = toMytYmd(input.startTime);
      const endYmd = toMytYmd(input.endTime || input.startTime);
      const endD = new Date(input.endTime || input.startTime);
      const endTimeMyt = endD.toLocaleTimeString('en-GB', {
        timeZone: APP_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const alreadyExclusive = endYmd > startYmd && endTimeMyt === '00:00';
      resolvedStartDate = startYmd;
      resolvedEndDate = alreadyExclusive ? shiftYmdDays(endYmd, -1) : endYmd;
      if (resolvedEndDate < resolvedStartDate) resolvedEndDate = resolvedStartDate;
      const endIcs = addOneDayCompact(resolvedEndDate);
      const exclusiveEndYmd = shiftYmdDays(resolvedEndDate, 1);
      dtLines = `DTSTART;VALUE=DATE:${resolvedStartDate.replace(/-/g, '')}\r\nDTEND;VALUE=DATE:${endIcs}`;
      returnStartIso = `${resolvedStartDate}T00:00:00${DEFAULT_TIMEZONE_OFFSET}`;
      returnEndIso = `${exclusiveEndYmd}T00:00:00${DEFAULT_TIMEZONE_OFFSET}`;
    }
  } else {
    dtLines = `DTSTART:${toUtcIcsTimestamp(input.startTime)}\r\nDTEND:${toUtcIcsTimestamp(input.endTime)}`;
    returnStartIso = new Date(input.startTime).toISOString();
    returnEndIso = new Date(input.endTime).toISOString();
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LifeOS//CalDAV//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    dtLines,
    `SUMMARY:${escapeIcs(input.title.trim())}`,
    ...(input.location?.trim() ? [`LOCATION:${escapeIcs(input.location.trim())}`] : []),
    ...(input.description?.trim() ? [`DESCRIPTION:${escapeIcs(input.description.trim())}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const putRes = await davRequest(
    itemUrl,
    'PUT',
    { 'Content-Type': 'text/calendar; charset=utf-8' },
    lines.join('\r\n')
  );

  if (putRes.status >= 400) {
    throw new Error(`Apple Calendar rejected event (HTTP ${putRes.status})`);
  }

  return {
    id: uid,
    title: input.title.trim(),
    calendarName: targetCal.name,
    startTime: returnStartIso,
    endTime: returnEndIso,
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
    isAllDay: Boolean(input.isAllDay),
    isRecurring: false,
    location: input.location?.trim() || undefined,
    description: input.description?.trim() || undefined,
  };
}

interface MatchedResource {
  calendarName: string;
  itemUrl: string;
  uid: string;
  summary: string;
  hasRrule: boolean;
  isExactTitle: boolean;
}

async function findMatchingCalendarResources(opts: {
  uid?: string;
  title?: string;
  daysPast?: number;
  daysFuture?: number;
}): Promise<MatchedResource[]> {
  const { calendars } = await discoverCollections();
  const baseUid = (opts.uid || '').split('::')[0].trim();
  const needle = (opts.title || '').trim().toLowerCase();
  if (!baseUid && !needle) return [];

  const now = new Date();
  const startRange = new Date(now.getTime() - (opts.daysPast ?? 30) * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const endRange = new Date(now.getTime() + (opts.daysFuture ?? 120) * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

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

  const writable = calendars.filter(isWritableCalendar);
  const perCal = await Promise.allSettled(
    writable.map(async cal => {
      const res = await davRequest(cal.url, 'REPORT', {
        'Depth': '1',
        'Content-Type': 'application/xml; charset=utf-8',
      }, reportBody);

      const matches: MatchedResource[] = [];
      const responseBlocks = [...res.text.matchAll(/<(?:[a-zA-Z0-9_-]+:)?response[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?response>/gi)];
      for (const block of responseBlocks) {
        const raw = block[0];
        const hrefMatch = /<(?:[a-zA-Z0-9_-]+:)?href[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?href>/i.exec(raw);
        if (!hrefMatch) continue;

        const unfolded = stripValarm(unfoldIcs(raw));
        const uidMatch = /^UID:([^\r\n]+)/im.exec(unfolded);
        const summaryMatch = /^SUMMARY(?:;[^:]+)?:([^\r\n]+)/im.exec(unfolded);
        const rawUid = uidMatch ? uidMatch[1].trim() : '';
        const rawSummary = summaryMatch ? unescapeIcs(summaryMatch[1].trim()) : '';
        const lowerSummary = rawSummary.toLowerCase();

        const matchedByUid = Boolean(baseUid && rawUid === baseUid);
        const matchedByTitle = !baseUid && Boolean(needle && (lowerSummary === needle || lowerSummary.includes(needle) || needle.includes(lowerSummary)));

        if (matchedByUid || matchedByTitle) {
          matches.push({
            calendarName: cal.name,
            itemUrl: resolveUrl(cal.url, hrefMatch[1].trim()),
            uid: rawUid,
            summary: rawSummary,
            hasRrule: /^RRULE:/im.test(unfolded),
            isExactTitle: Boolean(needle && lowerSummary === needle),
          });
        }
      }
      return matches;
    })
  );

  const all: MatchedResource[] = [];
  for (const r of perCal) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }
  if (!baseUid && all.some(m => m.isExactTitle)) {
    return all.filter(m => m.isExactTitle);
  }
  return all;
}

export async function deleteAppleCalendarEventByTitle(
  matchTitle: string,
  daysPast = 30,
  daysFuture = 120
): Promise<{ deletedCount: number; deletedCalendar?: string; skippedRecurring?: boolean }> {
  const matches = await findMatchingCalendarResources({ title: matchTitle, daysPast, daysFuture });
  if (matches.length === 0) return { deletedCount: 0 };

  if (matches.some(m => m.hasRrule)) {
    return { deletedCount: 0, skippedRecurring: true };
  }

  let deletedCount = 0;
  let deletedCalendar: string | undefined;
  await Promise.all(
    matches.map(async m => {
      const delRes = await davRequest(m.itemUrl, 'DELETE');
      if (delRes.status < 400) {
        deletedCount += 1;
        deletedCalendar = m.calendarName;
      }
    })
  );

  return { deletedCount, deletedCalendar };
}

export async function deleteAppleCalendarEventByUid(
  eventUid: string,
  fallbackTitle?: string,
  daysPast = 30,
  daysFuture = 120
): Promise<{ deletedCount: number; deletedCalendar?: string; skippedRecurring?: boolean }> {
  let matches = await findMatchingCalendarResources({ uid: eventUid, daysPast, daysFuture });
  if (matches.length === 0 && fallbackTitle) {
    matches = await findMatchingCalendarResources({ title: fallbackTitle, daysPast, daysFuture });
  }
  if (matches.length === 0) return { deletedCount: 0 };

  if (matches.some(m => m.hasRrule)) {
    return { deletedCount: 0, skippedRecurring: true };
  }

  let deletedCount = 0;
  let deletedCalendar: string | undefined;
  await Promise.all(
    matches.map(async m => {
      const delRes = await davRequest(m.itemUrl, 'DELETE');
      if (delRes.status < 400) {
        deletedCount += 1;
        deletedCalendar = m.calendarName;
      }
    })
  );

  return { deletedCount, deletedCalendar };
}

/**
 * Non-destructive calendar event update (create-before-delete):
 * Refuses recurring RRULE events, writes the replacement first, and only deletes the old copy after PUT succeeds.
 */
export async function updateAppleCalendarEvent(input: {
  uid?: string;
  oldTitle?: string;
  title: string;
  startTime: string;
  endTime: string;
  startDate?: string;
  endDate?: string;
  isAllDay?: boolean;
  location?: string;
  description?: string;
  calendarName?: string;
}): Promise<{ event: CalendarEvent; deletedOld: number }> {
  let oldMatches = input.uid
    ? await findMatchingCalendarResources({ uid: input.uid })
    : [];
  if (oldMatches.length === 0 && input.oldTitle) {
    oldMatches = await findMatchingCalendarResources({ title: input.oldTitle });
  }

  if (oldMatches.some(m => m.hasRrule)) {
    throw new Error('Recurring events cannot be modified from Life OS. Please edit the series in Apple Calendar.');
  }

  const targetCalName = input.calendarName || oldMatches[0]?.calendarName;

  // Create new replacement first so any iCloud PUT failure leaves original event intact
  const event = await createAppleCalendarEvent({
    title: input.title,
    startTime: input.startTime,
    endTime: input.endTime,
    startDate: input.startDate,
    endDate: input.endDate,
    isAllDay: input.isAllDay,
    location: input.location,
    description: input.description,
    calendarName: targetCalName,
  });

  let deletedOld = 0;
  if (oldMatches.length > 0) {
    await Promise.all(
      oldMatches.map(async m => {
        const delRes = await davRequest(m.itemUrl, 'DELETE');
        if (delRes.status < 400) deletedOld += 1;
      })
    );
  }

  return { event, deletedOld };
}
