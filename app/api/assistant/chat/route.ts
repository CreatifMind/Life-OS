import { NextResponse } from 'next/server';
import { fetchLiveCalendarEvents, fetchLiveReminders } from '@/lib/caldav';
import { fetchRecentEmails } from '@/lib/gmail';
import { callGemini } from '@/lib/gemini';

export const maxDuration = 30;

const USER_NAME = process.env.USER_NAME || 'Chris';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kuala_Lumpur';

export async function POST(req: Request) {
  try {
    const { message, history = [] } = await req.json();

    if (!message || !message.trim()) {
      return NextResponse.json({ success: false, error: 'Message cannot be empty' }, { status: 400 });
    }

    // 1. Fetch live ground truth
    const [eventsResult, remindersResult, emailsResult] = await Promise.allSettled([
      fetchLiveCalendarEvents(14, 30),
      fetchLiveReminders(),
      fetchRecentEmails(10),
    ]);

    const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
    const reminders = remindersResult.status === 'fulfilled' ? remindersResult.value : [];
    const emails = emailsResult.status === 'fulfilled' ? emailsResult.value : [];

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

    const prompt = `
You are the personal AI Life Assistant for ${USER_NAME} in Life OS.
Today is ${currentDateMYT}, ${currentTimeMYT} (${APP_TIMEZONE}).

You have live, direct read access to ${USER_NAME}'s Apple Calendar, Apple Reminders, and Gmail.
Always be direct, clear, highly concise, and practical.
NEVER fabricate, hallucinate, or guess dates, meetings, or emails not listed below.
If something is not in the data, state clearly that it is not on the schedule or list.

Ground Truth Data:
=== CALENDAR EVENTS ===
${events.length === 0 ? '(No events)' : events.map(e => `- [${e.calendarName}] "${e.title}" from ${e.startTime} to ${e.endTime}${e.location ? ` @ ${e.location}` : ''}`).join('\n')}

=== APPLE REMINDERS ===
${reminders.length === 0 ? '(No reminders)' : reminders.map(r => `- [${r.isCompleted ? 'COMPLETED' : 'OPEN'}] "${r.title}" (List: ${r.listName}, Priority: ${r.priority}${r.dueDate ? `, Due: ${r.dueDate}` : ''})`).join('\n')}

=== UNREAD GMAIL MESSAGES ===
${emails.length === 0 ? '(No unread emails)' : emails.map(m => `- From: "${m.senderName}" <${m.senderEmail}> | Subject: "${m.subject}" | Date: ${m.receivedAt} | Snippet: "${m.snippet}"`).join('\n')}

=== CONVERSATION HISTORY ===
${history.map((h: any) => `${h.role === 'user' ? USER_NAME : 'Assistant'}: ${h.text}`).join('\n')}

${USER_NAME} asks: "${message}"

Respond directly to ${USER_NAME}:
`;

    const reply = await callGemini(prompt);

    return NextResponse.json({
      success: true,
      reply,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
