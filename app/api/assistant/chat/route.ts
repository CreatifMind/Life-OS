import { NextResponse } from 'next/server';
import { fetchLiveCalendarEvents, fetchLiveReminders, createAppleCalendarEvent } from '@/lib/caldav';
import { fetchRecentEmails } from '@/lib/gmail';
import { callGemini } from '@/lib/gemini';
import { addPendingReminder } from '@/lib/db';

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
Always be direct, clear, concise, and reader-friendly.
NEVER output JSON, code blocks, or raw ISO timestamps.
Format your reply in clean, scannable plain text using bullet points (•), line breaks, and friendly dates/times (e.g. "Mon, Nov 16" or "2:00 PM").
If ${USER_NAME} explicitly asks you to create, add, or set a reminder/task, confirm it naturally AND append ONE hidden command line at the very end in this exact format:
[[ADD_REMINDER|Exact Task Title|YYYY-MM-DDTHH:mm:ss+08:00 or empty|Optional notes or empty]]
If ${USER_NAME} explicitly asks you to schedule, book, or add a calendar event/meeting, confirm it naturally AND append ONE hidden command line at the very end in this exact format:
[[ADD_EVENT|Exact Event Title|YYYY-MM-DDTHH:mm:ss+08:00|YYYY-MM-DDTHH:mm:ss+08:00|Optional location or empty]]
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

    const rawReply = await callGemini(prompt, 'text/plain');
    let reply = rawReply;
    let createdReminder: any = null;
    let createdEvent: any = null;

    const addMatch = /\[\[ADD_REMINDER\|([^|\]]+)\|([^|\]]*)\|([^\]]*)\]\]/i.exec(reply);
    if (addMatch) {
      const title = addMatch[1].trim();
      const rawDue = addMatch[2].trim();
      const notes = addMatch[3].trim();
      const dueDate = rawDue && !/^empty|none$/i.test(rawDue) ? rawDue : undefined;
      if (title) {
        createdReminder = await addPendingReminder({
          title,
          dueDate,
          notes: notes && !/^empty|none$/i.test(notes) ? notes : undefined,
        });
      }
      reply = reply.replace(addMatch[0], '').trim();
    }

    const eventMatch = /\[\[ADD_EVENT\|([^|\]]+)\|([^|\]]+)\|([^|\]]+)\|([^\]]*)\]\]/i.exec(reply);
    if (eventMatch) {
      const title = eventMatch[1].trim();
      const startTime = eventMatch[2].trim();
      const endTime = eventMatch[3].trim();
      const loc = eventMatch[4].trim();
      reply = reply.replace(eventMatch[0], '').trim();
      if (title && startTime && endTime) {
        try {
          createdEvent = await createAppleCalendarEvent({
            title,
            startTime,
            endTime,
            location: loc && !/^empty|none$/i.test(loc) ? loc : undefined,
          });
        } catch (evtErr: any) {
          console.error('Assistant failed to create calendar event:', evtErr.message);
          reply = `${reply}\n\n(Warning: Could not write to Apple Calendar — ${evtErr.message})`;
        }
      }
    }

    return NextResponse.json({
      success: true,
      reply,
      createdReminder,
      createdEvent,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
