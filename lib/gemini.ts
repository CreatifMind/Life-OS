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
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { code: number; message: string; status: string };
}

// Highly reliable high-availability models with generous free quotas
const MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];

export async function callGemini(
  prompt: string,
  responseMimeType: 'application/json' | 'text/plain' = 'application/json'
): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in .env.local');
  }

  let lastError = '';

  for (const model of MODELS) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType,
          },
        }),
      });

      const data: GeminiGenerateResponse = await res.json();
      if (data.error) {
        lastError = `${model}: ${data.error.message}`;
        continue;
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    } catch (err: any) {
      lastError = `${model}: ${err.message}`;
    }
  }

  throw new Error(`All Gemini models failed: ${lastError}`);
}

export async function generateDailyBriefing(
  events: CalendarEvent[],
  reminders: ReminderTask[],
  emails: EmailThread[]
): Promise<DailyBriefing> {
  const now = new Date();

  const currentDateMYT = now.toLocaleDateString('en-MY', {
    timeZone: APP_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const currentTimeMYT = now.toLocaleTimeString('en-MY', {
    timeZone: APP_TIMEZONE,
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

  // Calculate start of today in APP_TIMEZONE
  // Keep events from start of today onwards
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // "YYYY-MM-DD"

  const activeEvents = events.filter(e => {
    const endIso = e.endTime || e.startTime;
    const endStr = endIso.split('T')[0];
    return endStr >= todayStr || new Date(endIso).getTime() >= now.getTime() - 24 * 60 * 60 * 1000;
  });

  // Format events with explicit 12-hour AM/PM and real-time temporal status
  const formattedEvents = activeEvents.map(e => {
    const startD = new Date(e.startTime);
    const endD = new Date(e.endTime || e.startTime);
    const isPast = endD.getTime() < now.getTime();
    const isOngoing = startD.getTime() <= now.getTime() && endD.getTime() > now.getTime();

    const dateStr = startD.toLocaleDateString('en-MY', {
      timeZone: APP_TIMEZONE,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const startTimeStr = startD.toLocaleTimeString('en-MY', {
      timeZone: APP_TIMEZONE,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const endTimeStr = endD.toLocaleTimeString('en-MY', {
      timeZone: APP_TIMEZONE,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    if (e.isAllDay) {
      const isMultiDay = endD.getTime() - startD.getTime() > 24 * 60 * 60 * 1000;
      let status = '';
      if (isPast) {
        status = '[STATUS: PAST / COMPLETED]';
      } else if (isOngoing) {
        status = '[STATUS: ACTIVE TODAY (ALL DAY)]';
      } else {
        status = `[STATUS: UPCOMING ${isMultiDay ? 'MULTI-DAY' : 'ALL DAY'}]`;
      }
      return `- "${e.title}" [${e.calendarName}] ${status} on ${dateStr}${isMultiDay ? ` through ${endD.toLocaleDateString('en-MY', { timeZone: APP_TIMEZONE, month: 'short', day: 'numeric' })}` : ''}${e.location ? ` @ ${e.location}` : ''}`;
    }

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

  const prompt = `
You are the executive intelligence core of Life OS for user ${USER_NAME}.
Current real-world time: ${currentDateMYT}, ${currentTimeMYT} (${APP_TIMEZONE}).

Generate an authoritative, razor-sharp Executive Daily Briefing using ONLY the real ground-truth data below.
DO NOT hallucinate or invent unlisted meetings, obligations, or times.

CRITICAL TEMPORAL ACCURACY RULES:
1. Ground every statement strictly against the current real-world time: ${currentDateMYT}, ${currentTimeMYT}.
2. Past events are explicitly marked [STATUS: PAST / COMPLETED - ended X hours ago].
   - NEVER generate warnings, urgent alerts, or "starting in X minutes" notifications for completed/past events.
   - NEVER assign an event marked PAST / COMPLETED as a Top Priority to execute now.
3. Attention / Warnings Banner ("warningsOrOverdue"):
   - ONLY include real imminent events (starting in less than 60 minutes), overdue tasks, or urgent high-stakes unread emails.
   - If all of today's calendar commitments have already ended and there are no overdue tasks or urgent emails, return an EMPTY ARRAY: "warningsOrOverdue": [].
4. Top 3 Priorities:
   - Rank only actionable items: upcoming events/meetings, active reminders/tasks, or priority emails requiring replies.
   - If today has no remaining upcoming meetings, focus on tomorrow / upcoming multi-day commitments (e.g. Shanghai Fair), active reminders, or priority emails.

==================== GROUND TRUTH DATA ====================
1. CALENDAR SCHEDULE:
${formattedEvents.length === 0 ? '(No calendar events)' : formattedEvents.join('\n')}

2. ACTIVE TO-DOS & REMINDERS:
${cleanReminders.length === 0 ? '(No open reminders)' : cleanReminders.map(r => `- [${r.isCompleted ? 'COMPLETED' : 'OPEN'}] "${r.title}" (List: ${r.listName}${r.dueDate ? `, Due: ${r.dueDate.split('T')[0]}` : ''})`).join('\n')}

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
    const rawResponse = await callGemini(prompt);
    const cleaned = rawResponse.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    const briefing: DailyBriefing = {
      id: `briefing-${Date.now()}`,
      briefingDate: todayStr,
      generatedAt: now.toISOString(),
      headline: parsed.headline || `Good evening, ${USER_NAME}. Here is your operational briefing for ${currentDateMYT}.`,
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
      fullMarkdown: rawResponse,
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
      headline: `Good evening, ${USER_NAME}. You have ${upcomingEvents.length > 0 ? upcomingEvents[0].title : 'open focus time'} ahead and ${activeEvents.length} active commitment(s).`,
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
        : 'Your schedule for tonight is clear with open focus blocks.',
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
