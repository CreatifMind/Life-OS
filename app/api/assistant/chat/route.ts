import { NextResponse } from 'next/server';
import {
  fetchLiveCalendarEvents,
  fetchLiveReminders,
  createAppleCalendarEvent,
  deleteAppleCalendarEventByTitle,
} from '@/lib/caldav';
import { fetchRecentEmails } from '@/lib/gmail';
import { callGemini } from '@/lib/gemini';
import { addPendingReminder, getAssistantRules, addAssistantRule } from '@/lib/db';

export const maxDuration = 30;

const USER_NAME = process.env.USER_NAME || 'Chris';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kuala_Lumpur';

export async function POST(req: Request) {
  try {
    const { message, history = [] } = await req.json();

    if (!message || !message.trim()) {
      return NextResponse.json({ success: false, error: 'Message cannot be empty' }, { status: 400 });
    }

    // 1. Fetch live ground truth + persistent user rules
    const [eventsResult, remindersResult, emailsResult, rulesResult] = await Promise.allSettled([
      fetchLiveCalendarEvents(14, 30),
      fetchLiveReminders(),
      fetchRecentEmails(10),
      getAssistantRules(),
    ]);

    const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
    const reminders = remindersResult.status === 'fulfilled' ? remindersResult.value : [];
    const emails = emailsResult.status === 'fulfilled' ? emailsResult.value : [];
    const assistantRules = rulesResult.status === 'fulfilled' ? rulesResult.value : [];

    const now = new Date();
    const todayIsoMYT = new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now); // YYYY-MM-DD in MYT

    const currentDateMYT = now.toLocaleDateString('en-MY', {
      timeZone: APP_TIMEZONE,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const currentTimeMYT = now.toLocaleTimeString('en-MY', {
      timeZone: APP_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const prompt = `
You are the personal AI Life Assistant for ${USER_NAME} in Life OS.
Today is ${currentDateMYT} (ISO date: ${todayIsoMYT}), current time: ${currentTimeMYT} (${APP_TIMEZONE}).
IMPORTANT: When ${USER_NAME} says "today", you MUST use ${todayIsoMYT} in any ISO timestamp.

You have live, direct read access to ${USER_NAME}'s Apple Calendar, Apple Reminders, and Gmail.
Always be direct, clear, concise, and reader-friendly.
NEVER output JSON, code blocks, or raw ISO timestamps.
Format your reply in clean, scannable plain text using bullet points (•), line breaks, and friendly dates/times (e.g. "Mon, Nov 16" or "2:00 PM").
If ${USER_NAME} explicitly asks you to create, add, or set a reminder/task, confirm it naturally AND append ONE hidden command line at the very end in this exact format:
[[ADD_REMINDER|Exact Task Title|YYYY-MM-DDTHH:mm:ss+08:00 or empty|Optional notes or empty]]
If ${USER_NAME} explicitly asks you to schedule, book, or add a NEW calendar event/meeting, confirm it naturally AND append ONE hidden command line at the very end in this exact format:
[[ADD_EVENT|Exact Event Title|YYYY-MM-DDTHH:mm:ss+08:00|YYYY-MM-DDTHH:mm:ss+08:00|Calendar Name (Work or Personal)|Optional location or empty]]
If ${USER_NAME} asks you to MOVE, RESCHEDULE, or RE-CATEGORIZE an EXISTING calendar event (e.g. change its time or move it from Personal to Work), confirm it naturally AND append ONE hidden command line (NEVER use ADD_EVENT for a move/update):
[[MOVE_EVENT|Exact Existing Event Title|New Event Title|YYYY-MM-DDTHH:mm:ss+08:00|YYYY-MM-DDTHH:mm:ss+08:00|Calendar Name (Work or Personal)|Optional location or empty]]
If ${USER_NAME} asks you to DELETE or CANCEL an existing calendar event, confirm it naturally AND append:
[[DELETE_EVENT|Exact Existing Event Title]]
If ${USER_NAME} states a permanent scheduling/workflow preference ("from now on...", "always..."), append:
[[SAVE_RULE|Concise rule to remember permanently]]
NEVER fabricate, hallucinate, or guess dates, meetings, or emails not listed below.
If something is not in the data, state clearly that it is not on the schedule or list.

=== CALENDAR CLASSIFICATION RULES (WORK vs PERSONAL) ===
- Use "Work" for: meetings, client calls, interviews, syncs, presentations, work trips/fairs/expos (e.g. Japan Expo, Shanghai Fair), business contacts, or anything explicitly labeled Work.
- Use "Personal" for: sports & fitness (badminton, gym, run, pickleball, football, workout), social plans & meals (dinner, lunch, drinks, movie, hangout, date, family, friends), errands, hobbies, medical appointments, and personal travel/vacations.
- NEVER carry over "Work" from an earlier message in the conversation when scheduling a personal activity like badminton, gym, or dinner—unless ${USER_NAME} explicitly says it is for Work.

=== PERSISTENT USER RULES & PREFERENCES (ALWAYS FOLLOW) ===
${assistantRules.length === 0 ? '(None)' : assistantRules.map(r => `- ${r}`).join('\n')}

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
    let mutatedCalendar = false;

    // 1. Save persistent rule if requested
    const ruleMatch = /\[\[SAVE_RULE\|([^\]]+)\]\]/i.exec(reply);
    if (ruleMatch) {
      const ruleText = ruleMatch[1].trim();
      reply = reply.replace(ruleMatch[0], '').trim();
      if (ruleText) {
        await addAssistantRule(ruleText);
      }
    }

    // 2. Add Reminder
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

    // 3. Move / Update Existing Calendar Event (delete old + create updated)
    const moveMatch = /\[\[MOVE_EVENT\|([^|\]]+)\|([^|\]]+)\|([^|\]]+)\|([^|\]]+)\|([^|\]]*)\|([^\]]*)\]\]/i.exec(reply);
    if (moveMatch) {
      const existingTitle = moveMatch[1].trim();
      const newTitle = moveMatch[2].trim() || existingTitle;
      const startTime = moveMatch[3].trim();
      const endTime = moveMatch[4].trim();
      const calName = moveMatch[5].trim();
      const loc = moveMatch[6].trim();
      reply = reply.replace(moveMatch[0], '').trim();
      try {
        const delResult = await deleteAppleCalendarEventByTitle(existingTitle);
        createdEvent = await createAppleCalendarEvent({
          title: newTitle,
          startTime,
          endTime,
          calendarName: calName && !/^empty|none$/i.test(calName) ? calName : delResult.deletedCalendar,
          location: loc && !/^empty|none$/i.test(loc) ? loc : undefined,
        });
        mutatedCalendar = true;
        if (delResult.deletedCount === 0) {
          reply = `${reply}\n\n(Note: Created the updated event, but could not find an old "${existingTitle}" copy to remove.)`;
        }
      } catch (evtErr: any) {
        console.error('Assistant failed to move calendar event:', evtErr.message);
        reply = `${reply}\n\n(Warning: Could not update Apple Calendar — ${evtErr.message})`;
      }
    }

    // 4. Delete Existing Calendar Event
    const deleteMatch = /\[\[DELETE_EVENT\|([^\]]+)\]\]/i.exec(reply);
    if (deleteMatch) {
      const targetTitle = deleteMatch[1].trim();
      reply = reply.replace(deleteMatch[0], '').trim();
      try {
        const delResult = await deleteAppleCalendarEventByTitle(targetTitle);
        mutatedCalendar = true;
        if (delResult.deletedCount === 0) {
          reply = `${reply}\n\n(Note: Could not find "${targetTitle}" in Apple Calendar to delete.)`;
        }
      } catch (evtErr: any) {
        reply = `${reply}\n\n(Warning: Could not delete from Apple Calendar — ${evtErr.message})`;
      }
    }

    // 5. Add New Calendar Event (supports optional 5th calendarName field)
    // Safety net: if the user asked to move/reschedule/update an existing event and Gemini emitted ADD_EVENT, delete the old copy first!
    const isMoveIntent = /\b(move|reschedule|shift|change|update|push)\b/i.test(message);
    const userExplicitlySaidWork = /\b(work|client|office|business)\b/i.test(message);
    const userExplicitlySaidPersonal = /\b(personal|private)\b/i.test(message);
    const isObviouslyPersonal = (t: string) =>
      /\b(badminton|gym|workout|run|running|jog|pickleball|football|futsal|tennis|swim|swimming|dinner|lunch|breakfast|brunch|drinks|coffee|movie|cinema|hangout|date|party|concert|haircut|dentist|doctor|clinic|family|friends|ahma|mom|dad|vacation|holiday)\b/i.test(t);

    const eventMatch = /\[\[ADD_EVENT\|([^|\]]+)\|([^|\]]+)\|([^|\]]+)\|([^|\]]*)(?:\|([^\]]*))?\]\]/i.exec(reply);
    if (eventMatch) {
      const title = eventMatch[1].trim();
      const startTime = eventMatch[2].trim();
      const endTime = eventMatch[3].trim();
      const field4 = (eventMatch[4] || '').trim();
      const field5 = (eventMatch[5] || '').trim();
      const hasExplicitCal = eventMatch[5] !== undefined;
      let calName = hasExplicitCal ? field4 : undefined;
      const loc = hasExplicitCal ? field5 : field4;

      if (userExplicitlySaidPersonal) {
        calName = 'Personal';
      } else if (!userExplicitlySaidWork && isObviouslyPersonal(title)) {
        calName = 'Personal';
      }

      reply = reply.replace(eventMatch[0], '').trim();
      if (title && startTime && endTime) {
        try {
          if (isMoveIntent) {
            await deleteAppleCalendarEventByTitle(title);
            mutatedCalendar = true;
          }
          createdEvent = await createAppleCalendarEvent({
            title,
            startTime,
            endTime,
            calendarName: calName && !/^empty|none$/i.test(calName) ? calName : undefined,
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
      mutatedCalendar,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
