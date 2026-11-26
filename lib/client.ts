import { CalendarEvent } from './types';

/**
 * Safely fetches JSON from an API route without letting Safari/WebKit throw
 * cryptic "The string did not match the expected pattern." errors on HTML/504 responses.
 */
export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const signal =
    init?.signal ??
    (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(26000)
      : undefined);

  let res: Response;
  try {
    res = await fetch(input, { ...init, signal });
  } catch (err: any) {
    const name = err?.name || '';
    const msg = String(err?.message || '');
    if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(msg)) {
      throw new Error('Request timed out waiting for the server. Tap Retry to try again.');
    }
    throw new Error('Connection dropped before the server responded. Tap Retry to send again.');
  }

  if (
    res.status === 401 &&
    typeof window !== 'undefined' &&
    !window.location.pathname.startsWith('/login')
  ) {
    window.location.href = '/login';
    throw new Error('Session expired. Please sign in again.');
  }

  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';
  const trimmed = text.trim();

  let parsed: any = null;
  if (
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    contentType.toLowerCase().includes('application/json')
  ) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
  }

  if (parsed === null) {
    if (res.status === 504) {
      throw new Error('Request timed out on server. Please try again.');
    }
    if (res.status >= 500) {
      throw new Error(`Server error (HTTP ${res.status}). Please try again.`);
    }
    throw new Error(`Unexpected response (HTTP ${res.status}).`);
  }

  if (!res.ok || parsed?.success === false) {
    throw new Error(parsed?.error || `Request failed (HTTP ${res.status})`);
  }

  return parsed as T;
}

export function formatUtcOffsetFromMinutes(offsetEastMinutes: number): string {
  const sign = offsetEastMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetEastMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

export function getClientTimeZoneInfo(): {
  timeZone: string;
  tzLabel: string;
  utcOffset: string;
} {
  let timeZone = 'Asia/Kuala_Lumpur';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kuala_Lumpur';
  } catch {}

  const now = new Date();
  const utcOffset = formatUtcOffsetFromMinutes(-now.getTimezoneOffset());

  let tzLabel = utcOffset;
  if (timeZone === 'Asia/Kuala_Lumpur' || timeZone === 'Asia/Singapore') {
    tzLabel = 'MYT';
  } else {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'short',
      }).formatToParts(now);
      tzLabel = parts.find(p => p.type === 'timeZoneName')?.value || utcOffset;
    } catch {
      tzLabel = utcOffset;
    }
  }

  return { timeZone, tzLabel, utcOffset };
}

export function getLocalYmd(date: Date = new Date()): string {
  if (isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toLocalDateInput(iso?: string): string {
  if (!iso) return '';
  return getLocalYmd(new Date(iso));
}

export function toLocalTimeInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function toLocalIsoWithOffset(dateYmd: string, timeHm: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const [hh, mm] = (timeHm || '09:00').split(':').map(Number);
  const local = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  const offset = formatUtcOffsetFromMinutes(-local.getTimezoneOffset());
  const ly = local.getFullYear();
  const lm = String(local.getMonth() + 1).padStart(2, '0');
  const ld = String(local.getDate()).padStart(2, '0');
  const lhh = String(local.getHours()).padStart(2, '0');
  const lmm = String(local.getMinutes()).padStart(2, '0');
  return `${ly}-${lm}-${ld}T${lhh}:${lmm}:00${offset}`;
}

export function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * Returns inclusive { startYmd, endYmd } for any all-day event without timezone shift.
 */
export function getEventAllDayRange(event: CalendarEvent): { startYmd: string; endYmd: string } {
  if (event.startDate) {
    const startYmd = event.startDate;
    const endYmd = event.endDate && event.endDate >= startYmd ? event.endDate : startYmd;
    return { startYmd, endYmd };
  }

  const start = new Date(event.startTime);
  const end = new Date(event.endTime || event.startTime);
  const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let endMidnight = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  if (event.isAllDay && end.getTime() > start.getTime()) {
    endMidnight = new Date(endMidnight.getTime() - 24 * 60 * 60 * 1000);
  }
  if (endMidnight.getTime() < startMidnight.getTime()) {
    endMidnight = startMidnight;
  }

  return {
    startYmd: getLocalYmd(startMidnight),
    endYmd: getLocalYmd(endMidnight),
  };
}

/**
 * Shared upcoming event ID set so Schedule card count and mobile Schedule tab count stay identical.
 */
export function getUpcomingEventIds(events: CalendarEvent[]): Set<string> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ids = new Set<string>();

  for (const event of events) {
    if (event.isAllDay) {
      const { endYmd } = getEventAllDayRange(event);
      if (parseYmdLocal(endYmd).getTime() >= startOfToday) {
        ids.add(event.id);
      }
      continue;
    }

    const start = new Date(event.startTime);
    const end = new Date(event.endTime || event.startTime);
    const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const endMidnight = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    if (Math.max(startMidnight, endMidnight) >= startOfToday) {
      ids.add(event.id);
    }
  }

  return ids;
}
