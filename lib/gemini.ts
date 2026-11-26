/**
 * Life OS — Gemini AI Service
 * Grounded Intelligence Engine using Google AI Studio API (Free Tier)
 */

import { CalendarEvent, ReminderTask, EmailThread, DailyBriefing } from './types';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const USER_NAME = process.env.USER_NAME || 'Chris';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kuala_Lumpur';

interface GeminiGenerateResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
  }>;
  error?: { code: number; message: string; status: string };
}

const PRIMARY_MODEL = 'gemini-3.5-flash-lite';
const HEDGE_MODEL = 'gemini-3-flash-preview';
const LAST_RESORT_MODEL = 'gemini-3.6-flash';
const HEDGE_DELAY_MS = 3500;

function stripMarkdownJsonFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

async function trySingleModel(
  model: string,
  prompt: string,
  responseMimeType: 'application/json' | 'text/plain',
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`${model}: Timed out after ${timeoutMs}ms`)), timeoutMs);
  const onExternalAbort = () => controller.abort(externalSignal?.reason || new Error(`${model}: Cancelled`));

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new Error(`${model}: Cancelled`);
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType,
        },
      }),
    });

    const rawBody = await res.text();
    let data: GeminiGenerateResponse | null = null;
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new Error(`${model}: Non-JSON HTTP ${res.status}`);
    }

    if (!res.ok || data?.error) {
      throw new Error(`${model}: ${data?.error?.message || `HTTP ${res.status}`}`);
    }

    const cand = data?.candidates?.[0];
    if (!cand) {
      throw new Error(`${model}: Empty candidate list`);
    }

    if (cand.finishReason === 'MAX_TOKENS') {
      throw new Error(`${model}: Response truncated (MAX_TOKENS)`);
    }

    const text = (cand.content?.parts || [])
      .filter(p => !p.thought && typeof p.text === 'string')
      .map(p => p.text!)
      .join('')
      .trim();

    if (!text) {
      throw new Error(`${model}: Empty text output (finishReason=${cand.finishReason || 'unknown'})`);
    }

    if (responseMimeType === 'application/json') {
      try {
        JSON.parse(stripMarkdownJsonFences(text));
      } catch {
        throw new Error(`${model}: Malformed JSON output`);
      }
    }

    return text;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export async function callGemini(
  prompt: string,
  responseMimeType: 'application/json' | 'text/plain' = 'application/json'
): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in environment');
  }

  const hedgeAc = new AbortController();
  const errors: string[] = [];

  const runAttempt = (model: string, timeoutMs: number) =>
    trySingleModel(model, prompt, responseMimeType, timeoutMs, hedgeAc.signal);

  const primaryP = runAttempt(PRIMARY_MODEL, 7000);
  primaryP.catch(() => {});

  const timerOutcome = await new Promise<'hedge_due' | { ok: string } | { err: string }>(resolve => {
    const timer = setTimeout(() => resolve('hedge_due'), HEDGE_DELAY_MS);
    primaryP.then(
      text => {
        clearTimeout(timer);
        resolve({ ok: text });
      },
      err => {
        clearTimeout(timer);
        resolve({ err: err?.message || 'Primary failed' });
      }
    );
  });

  if (timerOutcome !== 'hedge_due') {
    if ('ok' in timerOutcome) {
      return timerOutcome.ok;
    }
    errors.push(timerOutcome.err);
    try {
      return await runAttempt(HEDGE_MODEL, 7000);
    } catch (err: any) {
      errors.push(err?.message || 'Hedge failed');
    }
  } else {
    const hedgeP = runAttempt(HEDGE_MODEL, 7000);
    hedgeP.catch(err => {
      errors.push(err?.message || 'Hedge failed');
    });
    primaryP.catch(err => {
      errors.push(err?.message || 'Primary failed');
    });

    try {
      const winner = await Promise.any([primaryP, hedgeP]);
      hedgeAc.abort();
      return winner;
    } catch {
      // Both hedged models failed; proceed to last resort
    }
  }

  try {
    return await trySingleModel(LAST_RESORT_MODEL, prompt, responseMimeType, 5000);
  } catch (err: any) {
    errors.push(err?.message || 'Last-resort model failed');
  }

  throw new Error(`All Gemini models failed: ${errors.join(' | ')}`);
}

export async function callGeminiJson<T = any>(prompt: string): Promise<T> {
  const raw = await callGemini(prompt, 'application/json');
  return JSON.parse(stripMarkdownJsonFences(raw)) as T;
}

function resolveSafeTimeZone(tz?: string): string {
  const candidate = (tz || '').trim() || APP_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return APP_TIMEZONE;
  }
}

export async function generateDailyBriefing(
  events: CalendarEvent[],
  reminders: ReminderTask[],
  emails: EmailThread[],
  timeZone?: string
): Promise<DailyBriefing> {
  const now = new Date();
  const activeTimeZone = resolveSafeTimeZone(timeZone);

  const currentDateLocal = now.toLocaleDateString('en-MY', {
    timeZone: activeTimeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const currentTimeLocal = now.toLocaleTimeString('en-MY', {
    timeZone: activeTimeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Filter out system upgrade placeholders or test items
  const cleanReminders = reminders.filter(r => {
    const t = r.title.toLowerCase();
    return (
      !t.includes('where are my reminders') &&
      !t.includes('upgraded these reminders') &&
      !t.includes('[life os test]') &&
      t !== 'task'
    );
  });

  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: activeTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // "YYYY-MM-DD"

  const formatYmdFriendly = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number);
    const utcDate = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
    return utcDate.toLocaleDateString('en-MY', {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const activeEvents = events.filter(e => {
    if (e.isAllDay && e.startDate) {
      const endYmd = e.endDate || e.startDate;
      return endYmd >= todayStr;
    }
    const endIso = e.endTime || e.startTime;
    const endStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: activeTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(endIso));
    return endStr >= todayStr || new Date(endIso).getTime() >= now.getTime() - 24 * 60 * 60 * 1000;
  });

  // Format events with explicit 12-hour AM/PM and real-time temporal status
  const formattedEvents = activeEvents.map(e => {
    if (e.isAllDay) {
      const startYmd =
        e.startDate ||
        new Intl.DateTimeFormat('en-CA', {
          timeZone: activeTimeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(e.startTime));
      const endYmd = e.endDate || startYmd;
      const isMultiDay = endYmd > startYmd;
      const isPast = endYmd < todayStr;
      const isOngoing = startYmd <= todayStr && endYmd >= todayStr;

      let status = '';
      if (isPast) {
        status = '[STATUS: PAST / COMPLETED]';
      } else if (isOngoing) {
        status = '[STATUS: ACTIVE TODAY (ALL DAY)]';
      } else {
        status = `[STATUS: UPCOMING ${isMultiDay ? 'MULTI-DAY' : 'ALL DAY'}]`;
      }
      return `- "${e.title}" [${e.calendarName}] ${status} on ${formatYmdFriendly(startYmd)}${isMultiDay ? ` through ${formatYmdFriendly(endYmd)}` : ''}${e.location ? ` @ ${e.location}` : ''}`;
    }

    const startD = new Date(e.startTime);
    const endD = new Date(e.endTime || e.startTime);
    const isPast = endD.getTime() < now.getTime();
    const isOngoing = startD.getTime() <= now.getTime() && endD.getTime() > now.getTime();

    const dateStr = startD.toLocaleDateString('en-MY', {
      timeZone: activeTimeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const startTimeStr = startD.toLocaleTimeString('en-MY', {
      timeZone: activeTimeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const endTimeStr = endD.toLocaleTimeString('en-MY', {
      timeZone: activeTimeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    let status = '';
    if (isPast) {
      const hoursAgo = Math.max(0.1, (now.getTime() - endD.getTime()) / (1000 * 60 * 60)).toFixed(1);
      status = `[STATUS: PAST / COMPLETED - ended ${hoursAgo} hours ago at ${endTimeStr}]`;
    } else if (isOngoing) {
      status = `[STATUS: IN PROGRESS NOW - ends at ${endTimeStr}]`;
    } else {
      const minutesUntil = Math.round((startD.getTime() - now.getTime()) / (1000 * 60));
      if (minutesUntil <= 60) {
        status = `[STATUS: IMMINENT - Starts in ${minutesUntil} minutes at ${startTimeStr}]`;
      } else if (minutesUntil < 24 * 60) {
        status = `[STATUS: UPCOMING TODAY - Starts at ${startTimeStr}]`;
      } else {
        status = `[STATUS: UPCOMING FUTURE - ${dateStr} at ${startTimeStr}]`;
      }
    }

    return `- "${e.title}" [${e.calendarName}] ${status} (Scheduled: ${dateStr} from ${startTimeStr} to ${endTimeStr})${e.location ? ` @ ${e.location}` : ''}`;
  });

  // Format reminders with explicit local date, 12-hour time, and real-time overdue status
  const formattedReminders = cleanReminders.map(r => {
    if (!r.dueDate) {
      return `- [${r.isCompleted ? 'COMPLETED' : 'OPEN'}] "${r.title}" (List: ${r.listName}, No due time)`;
    }
    const dueD = new Date(r.dueDate);
    if (isNaN(dueD.getTime())) {
      return `- [${r.isCompleted ? 'COMPLETED' : 'OPEN'}] "${r.title}" (List: ${r.listName})`;
    }
    const dueDateKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: activeTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dueD);
    const dueDateStr = dueD.toLocaleDateString('en-MY', {
      timeZone: activeTimeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const dueTimeStr = dueD.toLocaleTimeString('en-MY', {
      timeZone: activeTimeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    let statusTag = '';
    if (r.isCompleted) {
      statusTag = '[STATUS: COMPLETED]';
    } else if (dueD.getTime() < now.getTime()) {
      statusTag = `[STATUS: OVERDUE - was due ${dueDateStr} at ${dueTimeStr}]`;
    } else if (dueDateKey === todayStr) {
      statusTag = `[STATUS: DUE TODAY at ${dueTimeStr} - NOT OVERDUE YET]`;
    } else {
      statusTag = `[STATUS: UPCOMING - Due ${dueDateStr} at ${dueTimeStr}]`;
    }

    return `- "${r.title}" (List: ${r.listName}) ${statusTag}`;
  });

  const prompt = `
You are the executive intelligence core of Life OS for user ${USER_NAME}.
Current real-world time: ${currentDateLocal}, ${currentTimeLocal} (${activeTimeZone}).

Generate an authoritative, razor-sharp Executive Daily Briefing using ONLY the real ground-truth data below.
DO NOT hallucinate or invent unlisted meetings, obligations, or times.

CRITICAL TEMPORAL ACCURACY RULES:
1. Ground every statement strictly against the current real-world time: ${currentDateLocal}, ${currentTimeLocal}.
2. Past events are explicitly marked [STATUS: PAST / COMPLETED - ended X hours ago].
   - NEVER generate warnings, urgent alerts, or "starting in X minutes" notifications for completed/past events.
   - NEVER assign an event marked PAST / COMPLETED as a Top Priority to execute now.
3. Attention / Warnings Banner ("warningsOrOverdue"):
   - ONLY include real imminent events (starting in less than 60 minutes), reminders explicitly tagged [STATUS: OVERDUE ...], or urgent high-stakes unread emails.
   - NEVER mark a reminder as overdue if it is tagged [STATUS: DUE TODAY at ... - NOT OVERDUE YET] or [STATUS: UPCOMING ...].
   - If there are no overdue tasks, imminent events, or urgent emails, return an EMPTY ARRAY: "warningsOrOverdue": [].
4. Top 3 Priorities:
   - Rank only actionable items: upcoming events/meetings, active reminders/tasks, or priority emails requiring replies.
   - If today has no remaining upcoming meetings, focus on tomorrow / upcoming multi-day commitments, active reminders, or priority emails.

==================== GROUND TRUTH DATA ====================
1. CALENDAR SCHEDULE:
${formattedEvents.length === 0 ? '(No calendar events)' : formattedEvents.join('\n')}

2. ACTIVE TO-DOS & REMINDERS:
${formattedReminders.length === 0 ? '(No open reminders)' : formattedReminders.join('\n')}

3. PRIORITY EMAILS:
${emails.length === 0 ? '(No unread priority emails)' : emails.map(m => `- From: "${m.senderName}" <${m.senderEmail}> | Subject: "${m.subject}" | Snippet: "${m.snippet}"`).join('\n')}
===========================================================

Respond strictly in valid JSON matching this schema (BE ULTRA-CONCISE — zero filler words, short scannable phrases only):
{
  "headline": "Max 12 words summarizing today's main focus.",
  "topPriorities": [
    {
      "rank": 1,
      "title": "Short action/task title",
      "reason": "Max 8 words (e.g. 'Due today — client deliverables')",
      "source": "CALENDAR" | "REMINDER" | "GMAIL"
    },
    {
      "rank": 2,
      "title": "Second priority title",
      "reason": "Max 8 words",
      "source": "CALENDAR" | "REMINDER" | "GMAIL"
    },
    {
      "rank": 3,
      "title": "Third priority title",
      "reason": "Max 8 words",
      "source": "CALENDAR" | "REMINDER" | "GMAIL"
    }
  ],
  "agendaSummary": "Up to 4 ultra-short bullet lines separated by \\n (e.g. '• 10:00 AM Team Sync\\n• Afternoon: Open focus block'). No paragraphs.",
  "emailHighlights": "Up to 3 ultra-short bullet lines separated by \\n (e.g. '• Sender — action needed'). No paragraphs.",
  "warningsOrOverdue": ["Short phrase for truly urgent/overdue items only. If none, return []"],
  "suggestedPreparation": "1 short action phrase (max 12 words)."
}
`;

  try {
    const parsed = await callGeminiJson<any>(prompt);

    const briefing: DailyBriefing = {
      id: `briefing-${Date.now()}`,
      briefingDate: todayStr,
      generatedAt: now.toISOString(),
      headline: parsed.headline || `Good day, ${USER_NAME}. Here is your operational briefing for ${currentDateLocal}.`,
      topPriorities: (parsed.topPriorities || []).map((p: any, idx: number) => ({
        rank: p.rank || idx + 1,
        title: p.title || 'Focus Block',
        reason: p.reason || 'Strategic priority for today',
        source: (p.source || 'CALENDAR').toUpperCase() as 'CALENDAR' | 'REMINDER' | 'GMAIL',
      })),
      agendaSummary: parsed.agendaSummary || 'Schedule reviewed.',
      emailHighlights: parsed.emailHighlights || 'Priority correspondence reviewed.',
      warningsOrOverdue: parsed.warningsOrOverdue || [],
      suggestedPreparation: parsed.suggestedPreparation || 'Review upcoming events and proceed.',
      fullMarkdown: JSON.stringify(parsed),
      lastSyncTimestamp: now.toISOString(),
    };

    return briefing;
  } catch (err: any) {
    console.warn('Gemini briefing generation fallback:', err.message);
    const upcomingEvents = activeEvents.filter(e => new Date(e.startTime).getTime() > now.getTime());
    return {
      id: `briefing-${Date.now()}`,
      briefingDate: todayStr,
      generatedAt: now.toISOString(),
      headline: `Good day, ${USER_NAME}. You have ${upcomingEvents.length > 0 ? upcomingEvents[0].title : 'open focus time'} ahead and ${activeEvents.length} active commitment(s).`,
      topPriorities: [
        ...(upcomingEvents.length > 0
          ? [{
              rank: 1,
              title: upcomingEvents[0].title,
              reason: `Upcoming event in ${upcomingEvents[0].calendarName}`,
              source: 'CALENDAR' as const,
            }]
          : []),
        ...(cleanReminders.length > 0
          ? [{
              rank: upcomingEvents.length > 0 ? 2 : 1,
              title: cleanReminders[0].title,
              reason: 'Active task in Apple Reminders',
              source: 'REMINDER' as const,
            }]
          : []),
        ...(emails.length > 0
          ? [{
              rank: upcomingEvents.length > 0 ? (cleanReminders.length > 0 ? 3 : 2) : 1,
              title: emails[0].subject,
              reason: `Unread email from ${emails[0].senderName}`,
              source: 'GMAIL' as const,
            }]
          : []),
      ],
      agendaSummary: upcomingEvents.length > 0
        ? `Upcoming commitments: ${upcomingEvents.map(e => e.title).join(', ')}`
        : 'Your schedule is clear with open focus blocks.',
      emailHighlights: emails.length > 0
        ? `${emails.length} unread thread(s) in inbox.`
        : 'All priority inboxes are currently clear.',
      warningsOrOverdue: [],
      suggestedPreparation: upcomingEvents.length > 0
        ? `Prepare notes for ${upcomingEvents[0].title}.`
        : 'Review priority tasks and prepare for tomorrow.',
      fullMarkdown: '',
      lastSyncTimestamp: now.toISOString(),
    };
  }
}
