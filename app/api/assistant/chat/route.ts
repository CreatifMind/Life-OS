import { NextResponse } from 'next/server';
import {
  fetchLiveCalendarEvents,
  fetchLiveReminders,
  createAppleCalendarEvent,
  updateAppleCalendarEvent,
  deleteAppleCalendarEventByUid,
  deleteAppleCalendarEventByTitle,
} from '@/lib/caldav';
import { fetchRecentEmails } from '@/lib/gmail';
import { callGeminiJson } from '@/lib/gemini';
import {
  addPendingReminder,
  completeSyncedReminderByTitle,
  getAssistantRules,
  addAssistantRule,
} from '@/lib/db';
import { AssistantActionReceipt, CalendarEvent, ReminderTask } from '@/lib/types';

export const maxDuration = 30;

const USER_NAME = process.env.USER_NAME || 'Chris';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kuala_Lumpur';

function resolveSafeTimeZone(tz?: string): string {
  const candidate = (tz || '').trim() || APP_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return APP_TIMEZONE;
  }
}

function resolveSafeOffset(offset?: string): string {
  if (offset && /^[+-]\d{2}:\d{2}$/.test(offset.trim())) {
    return offset.trim();
  }
  return '+08:00';
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + deltaDays));
  const ny = String(dt.getUTCFullYear()).padStart(4, '0');
  const nm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(dt.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

function diffDaysInclusive(startYmd: string, endYmd: string): number {
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  const s = Date.UTC(sy, sm - 1, sd);
  const e = Date.UTC(ey, em - 1, ed);
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

function formatYmdFriendly(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
  return dt.toLocaleDateString('en-MY', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function extractYmd(val?: string): string | undefined {
  if (!val) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(val.trim());
  return m ? m[1] : undefined;
}

const isObviouslyPersonal = (t: string) =>
  /\b(badminton|gym|workout|run|running|jog|pickleball|football|futsal|tennis|swim|swimming|dinner|lunch|breakfast|brunch|drinks|coffee|movie|cinema|hangout|date|party|concert|haircut|dentist|doctor|clinic|family|friends|ahma|mom|mum|dad|vacation|holiday)\b/i.test(t);

interface AssistantResponsePayload {
  reply: string;
  actions?: Array<Record<string, any>>;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = typeof body?.message === 'string' ? body.message : '';
    const history = Array.isArray(body?.history) ? body.history.slice(-12) : [];
    const activeTimeZone = resolveSafeTimeZone(body?.timeZone);
    const activeOffset = resolveSafeOffset(body?.utcOffset);

    if (!message || !message.trim()) {
      return NextResponse.json({ success: false, error: 'Message cannot be empty' }, { status: 400 });
    }

    // 1. Fetch live ground truth + persistent user rules in parallel
    const [eventsResult, remindersResult, emailsResult, rulesResult] = await Promise.allSettled([
      fetchLiveCalendarEvents(14, 60),
      fetchLiveReminders(),
      fetchRecentEmails(10),
      getAssistantRules(),
    ]);

    const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
    const reminders = remindersResult.status === 'fulfilled' ? remindersResult.value : [];
    const emails = emailsResult.status === 'fulfilled' ? emailsResult.value : [];
    const assistantRules = rulesResult.status === 'fulfilled' ? rulesResult.value : [];

    const now = new Date();
    const todayIsoLocal = new Intl.DateTimeFormat('en-CA', {
      timeZone: activeTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const currentDateLocal = now.toLocaleDateString('en-MY', {
      timeZone: activeTimeZone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const currentTimeLocal = now.toLocaleTimeString('en-MY', {
      timeZone: activeTimeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const prompt = `
You are the personal AI Life Assistant for ${USER_NAME} in Life OS.
Today is ${currentDateLocal} (ISO date: ${todayIsoLocal}), current time: ${currentTimeLocal} (${activeTimeZone}, UTC offset: ${activeOffset}).
IMPORTANT: When ${USER_NAME} says "today", ALWAYS use ${todayIsoLocal}. Use offset ${activeOffset} in timestamps.

You have live, direct access to ${USER_NAME}'s Apple Calendar, Apple Reminders, and Gmail.
Respond strictly as a JSON object with this exact shape:
{
  "reply": "Clean, concise, reader-friendly plain text reply. Use bullet points (•) and friendly dates/times (e.g. 'Sat, Dec 5' or '7:00 PM'). NEVER put JSON, code blocks, or [[...]] syntax inside reply.",
  "actions": []
}

Supported action objects inside "actions":
1. ADD_EVENT:
   { "type": "ADD_EVENT", "title": "Exact Event Title", "isAllDay": false, "startTime": "YYYY-MM-DDTHH:mm:ss${activeOffset}", "endTime": "YYYY-MM-DDTHH:mm:ss${activeOffset}", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "calendarName": "Work" | "Personal", "location": "", "description": "" }
   - For timed events: provide startTime & endTime (with ${activeOffset}) and isAllDay: false.
   - For all-day or multi-day events/trips: provide isAllDay: true, startDate (YYYY-MM-DD), endDate (inclusive YYYY-MM-DD).
2. MOVE_EVENT (reschedule, rename, change time/dates, or move between Work/Personal):
   { "type": "MOVE_EVENT", "existingTitle": "Exact Existing Event Title", "existingDate": "YYYY-MM-DD of original event if multiple exist or specified", "newTitle": "Optional new title", "isAllDay": false, "startTime": "YYYY-MM-DDTHH:mm:ss${activeOffset}", "endTime": "YYYY-MM-DDTHH:mm:ss${activeOffset}", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "calendarName": "Work" | "Personal", "location": "" }
3. DELETE_EVENT:
   { "type": "DELETE_EVENT", "existingTitle": "Exact Existing Event Title", "existingDate": "YYYY-MM-DD of event to delete if specified or multiple exist" }
4. ADD_REMINDER:
   { "type": "ADD_REMINDER", "title": "Exact Task Title", "dueDate": "YYYY-MM-DDTHH:mm:ss${activeOffset} or empty string", "notes": "", "listName": "Reminders" }
5. UPDATE_REMINDER (change title, due date/time, clear due date, or notes of existing task):
   { "type": "UPDATE_REMINDER", "existingTitle": "Exact Existing Task Title", "newTitle": "Updated Title", "dueDate": "YYYY-MM-DDTHH:mm:ss${activeOffset} or empty", "clearDueDate": false, "notes": "" }
6. COMPLETE_REMINDER:
   { "type": "COMPLETE_REMINDER", "existingTitle": "Exact Existing Task Title" }
7. SAVE_RULE:
   { "type": "SAVE_RULE", "rule": "Concise permanent preference rule" }

=== CRITICAL SCHEDULING & HONESTY RULES ===
1. UNTIMED SINGLE-DAY EVENTS: If ${USER_NAME} asks to schedule a single-day event (e.g. dinner, lunch, meeting, call, badminton) and has NOT specified an explicit clock start time (e.g. "7pm", "19:00", "at 8") in the current message or recent conversation history, NEVER assume a default time like 7:00 PM, 12:00 PM, or 9:00 AM. You MUST set "actions": [] and ask ${USER_NAME} what start time they want BEFORE creating it.
   Example: "Can you set a dinner on 5th December at Cleaver Shed TTDI with my mum" -> "actions": [], "reply": "What time would you like me to schedule dinner with your mum at Cleaver Shed TTDI on Sat, Dec 5?"
2. START TIME ONLY: Once a start time is provided (with no end time specified), do NOT ask for the end time — auto-assign a sensible duration (1.5 hours for meals like dinner/lunch/brunch; 1 hour for meetings/calls/sports/errands) and create the event immediately.
3. TRIPS / ALL-DAY / REMINDERS: Multi-day trips (e.g. "Penang Jan 10-12"), explicit "all day" events, and Reminders without a due time MUST be created immediately without asking for a time.
4. RECURRING EVENTS: Events tagged [RECURRING] cannot be edited or deleted from Life OS. Do NOT emit MOVE_EVENT or DELETE_EVENT for them — tell ${USER_NAME} to update recurring series in Apple Calendar.
5. CALENDAR CLASSIFICATION (WORK vs PERSONAL):
   - "Work": meetings, client calls, interviews, syncs, presentations, work trips/conferences/expos/trade fairs, or explicitly Work.
   - "Personal": sports/fitness, social plans & meals (dinner, lunch, drinks, movie, hangout, date, family, friends), errands, medical, personal vacations/birthdays.
   - Never carry over "Work" from an earlier conversation turn for a personal plan unless explicitly told it is Work.
6. NEVER fabricate dates, events, tasks, or emails not listed below.

=== PERSISTENT USER RULES & PREFERENCES ===
${assistantRules.length === 0 ? '(None)' : assistantRules.map(r => `- ${r}`).join('\n')}

Ground Truth Data (timezone: ${activeTimeZone}):
=== CALENDAR EVENTS ===
${events.length === 0 ? '(No events)' : events.map(e => {
  const recTag = e.isRecurring ? ' [RECURRING]' : '';
  if (e.isAllDay && e.startDate) {
    const endLabel = e.endDate && e.endDate > e.startDate ? ` – ${formatYmdFriendly(e.endDate)}` : '';
    return `- [${e.calendarName}]${recTag} "${e.title}" on ${formatYmdFriendly(e.startDate)}${endLabel} (All Day)${e.location ? ` @ ${e.location}` : ''}`;
  }
  const s = new Date(e.startTime);
  const end = new Date(e.endTime || e.startTime);
  const datePart = s.toLocaleDateString('en-MY', { timeZone: activeTimeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = `${s.toLocaleTimeString('en-MY', { timeZone: activeTimeZone, hour: 'numeric', minute: '2-digit', hour12: true })} – ${end.toLocaleTimeString('en-MY', { timeZone: activeTimeZone, hour: 'numeric', minute: '2-digit', hour12: true })}`;
  return `- [${e.calendarName}]${recTag} "${e.title}" on ${datePart} (${timePart})${e.location ? ` @ ${e.location}` : ''}`;
}).join('\n')}

=== APPLE REMINDERS ===
${reminders.length === 0 ? '(No reminders)' : reminders.map(r => {
  let duePart = '';
  if (r.dueDate) {
    const d = new Date(r.dueDate);
    if (!isNaN(d.getTime())) {
      duePart = `, Due: ${d.toLocaleDateString('en-MY', { timeZone: activeTimeZone, weekday: 'short', month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString('en-MY', { timeZone: activeTimeZone, hour: 'numeric', minute: '2-digit', hour12: true })}`;
    }
  }
  return `- [${r.isCompleted ? 'COMPLETED' : 'OPEN'}] "${r.title}" (List: ${r.listName}${duePart})${r.notes ? ` | Notes: ${r.notes}` : ''}`;
}).join('\n')}

=== UNREAD GMAIL MESSAGES ===
${emails.length === 0 ? '(No unread emails)' : emails.map(m => `- From: "${m.senderName}" <${m.senderEmail}> | Subject: "${m.subject}" | Date: ${m.receivedAt} | Snippet: "${m.snippet}"`).join('\n')}

=== CONVERSATION HISTORY ===
${history.map((h: any) => `${h.role === 'user' ? USER_NAME : 'Assistant'}: ${h.text}`).join('\n')}

${USER_NAME} asks: "${message}"
`;

    const aiOutput = await callGeminiJson<AssistantResponsePayload>(prompt);
    let reply = String(aiOutput?.reply || '').replace(/\[\[[A-Z_]+\|[\s\S]*?(?:\]\]|$)/g, '').trim();
    const actions = Array.isArray(aiOutput?.actions) ? aiOutput.actions : [];

    const createdReminders: ReminderTask[] = [];
    const createdEvents: CalendarEvent[] = [];
    const actionResults: AssistantActionReceipt[] = [];
    let mutatedReminders = false;
    let mutatedCalendar = false;

    const isMoveIntent = /\b(move|reschedule|shift|change|update|push)\b/i.test(message);
    const userExplicitlySaidEvent = /\b(event|calendar|meeting|trip)\b/i.test(message);
    const userExplicitlySaidWork = /\b(work|client|office|business)\b/i.test(message);
    const userExplicitlySaidPersonal = /\b(personal|private)\b/i.test(message);

    const hasExplicitClockTime = [
      message,
      ...history.filter((h: any) => h?.role === 'user').slice(-2).map((h: any) => String(h.text || '')),
    ].some(txt =>
      /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\b(?:at\s+\d{1,2}|noon|midnight)\b|\b\d{4}\s*hrs?\b/i.test(txt)
    );
    const hasExplicitAllDayIntent = /\b(all[\s-]*day|whole\s*day|full\s*day|trip|vacation|holiday)\b/i.test(message);

    const findMatchingCalendarEvent = (t: string, existingDate?: string): CalendarEvent | undefined => {
      const needle = t.trim().toLowerCase();
      if (!needle) return undefined;

      let bestEvent: CalendarEvent | undefined;
      let bestScore = 0;

      for (const e of events) {
        const et = e.title.trim().toLowerCase();
        let score = 0;
        if (et === needle) score = 100;
        else if (et.includes(needle) || needle.includes(et)) score = 40;
        else continue;

        if (existingDate) {
          let matchesDate = false;
          if (e.isAllDay && e.startDate) {
            const endYmd = e.endDate || e.startDate;
            matchesDate = existingDate >= e.startDate && existingDate <= endYmd;
          } else {
            const localYmd = new Intl.DateTimeFormat('en-CA', {
              timeZone: activeTimeZone,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(new Date(e.startTime));
            matchesDate = localYmd === existingDate;
          }
          score += matchesDate ? 60 : -30;
        }

        if (score > bestScore) {
          bestScore = score;
          bestEvent = e;
        }
      }

      return bestEvent;
    };

    const hasMatchingReminder = (t: string): boolean => {
      const needle = t.trim().toLowerCase();
      if (!needle) return false;
      return reminders.some(r => {
        const rt = r.title.trim().toLowerCase();
        return !r.isCompleted && (rt === needle || rt.includes(needle) || needle.includes(rt));
      });
    };

    for (const action of actions) {
      if (!action || typeof action.type !== 'string') continue;
      const type = action.type.toUpperCase();

      if (type === 'SAVE_RULE') {
        const ruleText = String(action.rule || '').trim();
        if (ruleText) {
          await addAssistantRule(ruleText);
          actionResults.push({ status: 'success', label: 'Saved assistant rule', detail: ruleText });
        }
        continue;
      }

      if (type === 'ADD_REMINDER') {
        const title = String(action.title || '').trim();
        if (!title) continue;
        const dueDate = action.dueDate && !/^empty|none$/i.test(String(action.dueDate).trim())
          ? String(action.dueDate).trim()
          : undefined;
        const notes = action.notes && !/^empty|none$/i.test(String(action.notes).trim())
          ? String(action.notes).trim()
          : undefined;
        const listName = action.listName ? String(action.listName).trim() : 'Reminders';

        try {
          const task = await addPendingReminder({
            title,
            listName,
            replaceTitle: isMoveIntent ? title : undefined,
            dueDate,
            notes,
          });
          createdReminders.push(task);
          if (isMoveIntent) mutatedReminders = true;
          actionResults.push({ status: 'success', label: `Added reminder "${title}"` });
        } catch (err: any) {
          actionResults.push({ status: 'error', label: `Failed to add reminder "${title}"`, detail: err.message });
        }
        continue;
      }

      if (type === 'UPDATE_REMINDER') {
        const existingTitle = String(action.existingTitle || action.title || '').trim();
        const newTitle = String(action.newTitle || existingTitle).trim();
        if (!existingTitle || !newTitle) continue;

        const existingDate = extractYmd(action.existingDate);
        const matchedCalEvt = findMatchingCalendarEvent(existingTitle, existingDate);
        if (matchedCalEvt && (userExplicitlySaidEvent || !hasMatchingReminder(existingTitle))) {
          if (matchedCalEvt.isRecurring) {
            actionResults.push({
              status: 'skipped',
              label: `"${matchedCalEvt.title}" is recurring`,
              detail: 'Edit recurring series in Apple Calendar.',
            });
            continue;
          }
          const targetCal = userExplicitlySaidPersonal
            ? 'Personal'
            : userExplicitlySaidWork
            ? 'Work'
            : matchedCalEvt.calendarName;
          try {
            const { event } = await updateAppleCalendarEvent({
              uid: matchedCalEvt.id,
              oldTitle: matchedCalEvt.title,
              title: newTitle,
              startTime: matchedCalEvt.startTime,
              endTime: matchedCalEvt.endTime,
              startDate: matchedCalEvt.startDate,
              endDate: matchedCalEvt.endDate,
              isAllDay: Boolean(matchedCalEvt.isAllDay),
              calendarName: targetCal,
              location: matchedCalEvt.location,
              description: matchedCalEvt.description,
            });
            createdEvents.push(event);
            mutatedCalendar = true;
            actionResults.push({ status: 'success', label: `Updated "${event.title}" in ${event.calendarName}` });
          } catch (err: any) {
            actionResults.push({ status: 'error', label: `Failed to update "${matchedCalEvt.title}"`, detail: err.message });
          }
          continue;
        }

        const clearDue = Boolean(action.clearDueDate);
        const dueDate = !clearDue && action.dueDate && !/^empty|none$/i.test(String(action.dueDate).trim())
          ? String(action.dueDate).trim()
          : undefined;
        const notes = action.notes && !/^empty|none$/i.test(String(action.notes).trim())
          ? String(action.notes).trim()
          : undefined;

        try {
          const task = await addPendingReminder({
            title: newTitle,
            replaceTitle: existingTitle,
            dueDate,
            clearDueDate: clearDue,
            notes,
          });
          createdReminders.push(task);
          mutatedReminders = true;
          actionResults.push({ status: 'success', label: `Updated reminder "${newTitle}"` });
        } catch (err: any) {
          actionResults.push({ status: 'error', label: `Failed to update reminder "${existingTitle}"`, detail: err.message });
        }
        continue;
      }

      if (type === 'COMPLETE_REMINDER') {
        const targetTitle = String(action.existingTitle || action.title || '').trim();
        if (!targetTitle) continue;
        try {
          const ok = await completeSyncedReminderByTitle(targetTitle);
          if (ok) {
            mutatedReminders = true;
            actionResults.push({ status: 'success', label: `Completed "${targetTitle}"` });
          } else {
            actionResults.push({
              status: 'skipped',
              label: `No open reminder matching "${targetTitle}"`,
            });
          }
        } catch (err: any) {
          actionResults.push({ status: 'error', label: `Failed to complete "${targetTitle}"`, detail: err.message });
        }
        continue;
      }

      if (type === 'DELETE_EVENT') {
        const targetTitle = String(action.existingTitle || action.title || '').trim();
        if (!targetTitle) continue;

        const existingDate = extractYmd(action.existingDate);
        const matchedOrig = findMatchingCalendarEvent(targetTitle, existingDate);
        if (matchedOrig?.isRecurring) {
          actionResults.push({
            status: 'skipped',
            label: `"${matchedOrig.title}" is recurring`,
            detail: 'Delete recurring series in Apple Calendar.',
          });
          continue;
        }

        try {
          const delResult = matchedOrig?.id
            ? await deleteAppleCalendarEventByUid(matchedOrig.id, matchedOrig.title)
            : await deleteAppleCalendarEventByTitle(targetTitle);
          if (delResult.skippedRecurring) {
            actionResults.push({
              status: 'skipped',
              label: `"${targetTitle}" is recurring`,
              detail: 'Delete recurring series in Apple Calendar.',
            });
          } else if (delResult.deletedCount > 0) {
            mutatedCalendar = true;
            actionResults.push({ status: 'success', label: `Deleted "${matchedOrig?.title || targetTitle}"` });
          } else {
            actionResults.push({ status: 'skipped', label: `Could not find "${targetTitle}" in Apple Calendar` });
          }
        } catch (err: any) {
          actionResults.push({ status: 'error', label: `Failed to delete "${targetTitle}"`, detail: err.message });
        }
        continue;
      }

      if (type === 'MOVE_EVENT') {
        const existingTitle = String(action.existingTitle || '').trim();
        const newTitle = String(action.newTitle || existingTitle).trim();
        if (!existingTitle && !newTitle) continue;

        const existingDate = extractYmd(action.existingDate);
        const matchedOrig = findMatchingCalendarEvent(existingTitle || newTitle, existingDate);
        if (matchedOrig?.isRecurring) {
          actionResults.push({
            status: 'skipped',
            label: `"${matchedOrig.title}" is recurring`,
            detail: 'Edit recurring series in Apple Calendar.',
          });
          continue;
        }

        const useAllDay = action.isAllDay !== undefined ? Boolean(action.isAllDay) : Boolean(matchedOrig?.isAllDay);
        let calName = action.calendarName && !/^empty|none$/i.test(String(action.calendarName).trim())
          ? String(action.calendarName).trim()
          : matchedOrig?.calendarName;
        if (userExplicitlySaidPersonal) calName = 'Personal';
        else if (userExplicitlySaidWork) calName = 'Work';

        const location = action.location && !/^empty|none$/i.test(String(action.location).trim())
          ? String(action.location).trim()
          : matchedOrig?.location;

        let startDate = extractYmd(action.startDate) || (useAllDay ? extractYmd(action.startTime) : undefined);
        let endDate = extractYmd(action.endDate) || (useAllDay ? extractYmd(action.endTime) : undefined);

        if (useAllDay) {
          const origStart = matchedOrig?.startDate || extractYmd(matchedOrig?.startTime);
          const origEnd = matchedOrig?.endDate || origStart;
          if (!startDate && origStart) startDate = origStart;
          if (startDate && !endDate) {
            if (origStart && origEnd) {
              const spanDays = diffDaysInclusive(origStart, origEnd);
              endDate = shiftYmd(startDate, spanDays - 1);
            } else {
              endDate = startDate;
            }
          }
        }

        const startTime = useAllDay && startDate
          ? `${startDate}T00:00:00${activeOffset}`
          : String(action.startTime || matchedOrig?.startTime || '').trim();
        const endTime = useAllDay && (endDate || startDate)
          ? `${shiftYmd(endDate || startDate!, 1)}T00:00:00${activeOffset}`
          : String(action.endTime || matchedOrig?.endTime || '').trim();

        if (!startTime || !endTime) {
          actionResults.push({ status: 'error', label: `Missing new date/time for "${existingTitle}"` });
          continue;
        }

        try {
          const { event } = await updateAppleCalendarEvent({
            uid: matchedOrig?.id,
            oldTitle: matchedOrig?.title || existingTitle,
            title: newTitle || existingTitle,
            startTime,
            endTime,
            startDate,
            endDate,
            isAllDay: useAllDay,
            calendarName: calName,
            location,
            description: matchedOrig?.description,
          });
          createdEvents.push(event);
          mutatedCalendar = true;
          actionResults.push({ status: 'success', label: `Updated "${event.title}" (${event.calendarName})` });
        } catch (err: any) {
          actionResults.push({ status: 'error', label: `Failed to update "${existingTitle}"`, detail: err.message });
        }
        continue;
      }

      if (type === 'ADD_EVENT') {
        const title = String(action.title || '').trim();
        if (!title) continue;

        const isAllDay = Boolean(action.isAllDay);
        if (!isAllDay && !hasExplicitClockTime && !hasExplicitAllDayIntent) {
          const proposedYmd = extractYmd(action.startTime) || extractYmd(action.startDate);
          const dateLabel = proposedYmd ? ` on ${formatYmdFriendly(proposedYmd)}` : '';
          reply = `What time would you like me to schedule "${title}"${dateLabel}?`;
          continue;
        }
        let calName = action.calendarName && !/^empty|none$/i.test(String(action.calendarName).trim())
          ? String(action.calendarName).trim()
          : undefined;
        if (userExplicitlySaidPersonal) calName = 'Personal';
        else if (!userExplicitlySaidWork && isObviouslyPersonal(title)) calName = 'Personal';

        const location = action.location && !/^empty|none$/i.test(String(action.location).trim())
          ? String(action.location).trim()
          : undefined;
        const description = action.description && !/^empty|none$/i.test(String(action.description).trim())
          ? String(action.description).trim()
          : undefined;

        const startDate = isAllDay ? (extractYmd(action.startDate) || extractYmd(action.startTime)) : undefined;
        const endDate = isAllDay ? (extractYmd(action.endDate) || extractYmd(action.endTime) || startDate) : undefined;
        const startTime = isAllDay && startDate
          ? `${startDate}T00:00:00${activeOffset}`
          : String(action.startTime || '').trim();
        const endTime = isAllDay && (endDate || startDate)
          ? `${shiftYmd(endDate || startDate!, 1)}T00:00:00${activeOffset}`
          : String(action.endTime || '').trim();

        if (!startTime || !endTime) {
          actionResults.push({ status: 'error', label: `Missing time for "${title}"` });
          continue;
        }

        try {
          const event = await createAppleCalendarEvent({
            title,
            startTime,
            endTime,
            startDate,
            endDate,
            isAllDay,
            calendarName: calName,
            location,
            description,
          });
          createdEvents.push(event);
          mutatedCalendar = true;
          actionResults.push({ status: 'success', label: `Added "${event.title}" to ${event.calendarName}` });
        } catch (err: any) {
          actionResults.push({ status: 'error', label: `Failed to add "${title}"`, detail: err.message });
        }
      }
    }

    // Server-verified honesty check: never let reply claim success when mutations failed
    const failures = actionResults.filter(a => a.status === 'error');
    const successes = actionResults.filter(a => a.status === 'success');
    const skipped = actionResults.filter(a => a.status === 'skipped');

    if (failures.length > 0) {
      const failureSummary = failures
        .map(f => `• ${f.label}${f.detail ? `: ${f.detail}` : ''}`)
        .join('\n');
      if (successes.length === 0) {
        reply = `I couldn't complete that update:\n${failureSummary}`;
      } else {
        reply = `${reply}\n\nSome actions failed:\n${failureSummary}`;
      }
    } else if (skipped.length > 0 && successes.length === 0) {
      const skipSummary = skipped.map(s => `• ${s.label}${s.detail ? ` — ${s.detail}` : ''}`).join('\n');
      if (!/apple calendar|couldn't|cannot|not find|recurring/i.test(reply)) {
        reply = `${reply}\n\n${skipSummary}`;
      }
    }

    return NextResponse.json({
      success: true,
      reply,
      actionResults,
      createdEvents,
      createdEvent: createdEvents[createdEvents.length - 1] || null,
      mutatedCalendar,
      createdReminders,
      createdReminder: createdReminders[createdReminders.length - 1] || null,
      mutatedReminders,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
