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

export async function callGemini(prompt: string): Promise<string> {
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
            responseMimeType: 'application/json',
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
  const currentDateMYT = new Date().toLocaleDateString('en-MY', {
    timeZone: APP_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const currentTimeMYT = new Date().toLocaleTimeString('en-MY', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
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

  // Filter out ancient past events (keep events from start of today onwards)
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const activeEvents = events.filter(e => {
    const eventEnd = new Date(e.endTime || e.startTime).getTime();
    return eventEnd >= startOfToday;
  });

  const prompt = `
You are the executive intelligence core of Life OS for user ${USER_NAME}.
Today is ${currentDateMYT}, ${currentTimeMYT} (${APP_TIMEZONE}).

Generate an authoritative, razor-sharp Executive Daily Briefing using ONLY the real ground-truth data below.
DO NOT hallucinate or invent unlisted meetings or obligations.

==================== GROUND TRUTH DATA ====================
1. CALENDAR SCHEDULE (Current & Upcoming):
${activeEvents.length === 0 ? '(No upcoming calendar events)' : activeEvents.map(e => {
  const startD = new Date(e.startTime);
  const endD = new Date(e.endTime);
  const isMultiDay = endD.getTime() - startD.getTime() > 24 * 60 * 60 * 1000;
  return `- "${e.title}" [${e.calendarName}] (${e.isAllDay ? (isMultiDay ? 'Multi-day from ' + e.startTime.split('T')[0] + ' to ' + e.endTime.split('T')[0] : 'All Day on ' + e.startTime.split('T')[0]) : e.startTime.split('T')[0] + ' from ' + e.startTime.split('T')[1].substring(0, 5) + ' to ' + e.endTime.split('T')[1].substring(0, 5)})${e.location ? ` @ ${e.location}` : ''}`;
}).join('\n')}

2. ACTIVE TO-DOS & REMINDERS:
${cleanReminders.length === 0 ? '(No open reminders)' : cleanReminders.map(r => `- [${r.isCompleted ? 'COMPLETED' : 'OPEN'}] "${r.title}" (List: ${r.listName}${r.dueDate ? `, Due: ${r.dueDate.split('T')[0]}` : ''})`).join('\n')}

3. PRIORITY EMAILS:
${emails.length === 0 ? '(No unread priority emails)' : emails.map(m => `- From: "${m.senderName}" <${m.senderEmail}> | Subject: "${m.subject}" | Snippet: "${m.snippet}"`).join('\n')}
===========================================================

Respond strictly in valid JSON matching this schema:
{
  "headline": "A punchy, insightful 1-sentence executive summary tailored specifically to today's schedule and commitments",
  "topPriorities": [
    {
      "rank": 1,
      "title": "Exact title of highest priority task/commitment for today",
      "reason": "Why this matters most today (time-critical meeting, deadline, or immediate action)",
      "source": "CALENDAR" | "REMINDER" | "GMAIL"
    },
    {
      "rank": 2,
      "title": "Second priority title",
      "reason": "Why it matters",
      "source": "CALENDAR" | "REMINDER" | "GMAIL"
    },
    {
      "rank": 3,
      "title": "Third priority title",
      "reason": "Why it matters",
      "source": "CALENDAR" | "REMINDER" | "GMAIL"
    }
  ],
  "agendaSummary": "2-3 concise sentences detailing schedule flow, appointments, or open focus blocks.",
  "emailHighlights": "2-3 concise sentences identifying urgent senders or emails needing replies.",
  "warningsOrOverdue": ["List any overdue items, tight meeting intervals, or urgent follow-ups"],
  "suggestedPreparation": "1 actionable sentence on what to prepare before starting the day."
}
`;

  try {
    const rawResponse = await callGemini(prompt);
    const cleaned = rawResponse.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    const briefing: DailyBriefing = {
      id: `briefing-${Date.now()}`,
      briefingDate: new Date().toISOString().split('T')[0],
      generatedAt: new Date().toISOString(),
      headline: parsed.headline || `Good morning, ${USER_NAME}. Here is your operational briefing for ${currentDateMYT}.`,
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
      lastSyncTimestamp: new Date().toISOString(),
    };

    return briefing;
  } catch (err: any) {
    console.warn('Gemini briefing generation fallback:', err.message);
    const todayEvents = activeEvents.filter(e => e.startTime.startsWith(new Date().toISOString().split('T')[0]));
    return {
      id: `briefing-${Date.now()}`,
      briefingDate: new Date().toISOString().split('T')[0],
      generatedAt: new Date().toISOString(),
      headline: `Good morning, ${USER_NAME}. You have ${todayEvents.length > 0 ? todayEvents[0].title : 'open focus time'} today and ${activeEvents.length} upcoming commitment(s).`,
      topPriorities: [
        ...(todayEvents.length > 0
          ? [{
              rank: 1,
              title: todayEvents[0].title,
              reason: `Scheduled event today at ${todayEvents[0].startTime.split('T')[1]?.substring(0, 5) || 'all-day'} in ${todayEvents[0].calendarName}`,
              source: 'CALENDAR' as const,
            }]
          : []),
        ...(cleanReminders.length > 0
          ? [{
              rank: todayEvents.length > 0 ? 2 : 1,
              title: cleanReminders[0].title,
              reason: 'Active task in Apple Reminders',
              source: 'REMINDER' as const,
            }]
          : []),
        ...(activeEvents.length > 1
          ? [{
              rank: 3,
              title: activeEvents[1].title,
              reason: `Upcoming event on ${activeEvents[1].startTime.split('T')[0]}`,
              source: 'CALENDAR' as const,
            }]
          : []),
      ],
      agendaSummary: activeEvents.length > 0
        ? `Upcoming: ${activeEvents.map(e => e.title).join(', ')}`
        : 'Your schedule has open focus blocks for deep work today.',
      emailHighlights: emails.length > 0
        ? `${emails.length} unread thread(s) in inbox.`
        : 'All priority inboxes are currently clear.',
      warningsOrOverdue: [],
      suggestedPreparation: todayEvents.length > 0
        ? `Prepare notes for ${todayEvents[0].title} before starting the day.`
        : 'Review priority tasks and schedule deep work.',
      fullMarkdown: '',
      lastSyncTimestamp: new Date().toISOString(),
    };
  }
}
