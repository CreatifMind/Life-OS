import { NextResponse } from 'next/server';
import { fetchLiveCalendarEvents, fetchLiveReminders } from '@/lib/caldav';
import { fetchRecentEmails } from '@/lib/gmail';
import { generateDailyBriefing } from '@/lib/gemini';
import { saveBriefingToDb, getLatestBriefingFromDb } from '@/lib/db';

export const maxDuration = 30;

async function generateAndPersistBriefing(body?: any) {
  const timeZone = typeof body?.timeZone === 'string' ? body.timeZone : undefined;
  const hasClientPayload =
    Array.isArray(body?.events) &&
    Array.isArray(body?.reminders) &&
    Array.isArray(body?.emails);

  let events = body?.events;
  let reminders = body?.reminders;
  let emails = body?.emails;

  if (!hasClientPayload) {
    const [eventsResult, remindersResult, emailsResult] = await Promise.allSettled([
      fetchLiveCalendarEvents(14, 60),
      fetchLiveReminders(),
      fetchRecentEmails(10),
    ]);

    events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
    reminders = remindersResult.status === 'fulfilled' ? remindersResult.value : [];
    emails = emailsResult.status === 'fulfilled' ? emailsResult.value : [];
  }

  const briefing = await generateDailyBriefing(events, reminders, emails, timeZone);
  await saveBriefingToDb(briefing);

  return NextResponse.json({
    success: true,
    briefing,
  });
}

export async function GET() {
  try {
    const cached = await getLatestBriefingFromDb();
    if (cached) {
      return NextResponse.json({ success: true, briefing: cached });
    }
    return await generateAndPersistBriefing();
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    return await generateAndPersistBriefing(body);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
