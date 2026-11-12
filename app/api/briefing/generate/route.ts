import { NextResponse } from 'next/server';
import { fetchLiveCalendarEvents, fetchLiveReminders } from '@/lib/caldav';
import { fetchRecentEmails } from '@/lib/gmail';
import { generateDailyBriefing } from '@/lib/gemini';
import { saveBriefingToDb, getLatestBriefingFromDb } from '@/lib/db';

export const maxDuration = 30;

export async function GET() {
  try {
    const cached = await getLatestBriefingFromDb();
    if (cached) {
      return NextResponse.json({ success: true, briefing: cached });
    }
    // If none exists, generate one
    return POST();
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const [eventsResult, remindersResult, emailsResult] = await Promise.allSettled([
      fetchLiveCalendarEvents(),
      fetchLiveReminders(),
      fetchRecentEmails(10),
    ]);

    const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
    const reminders = remindersResult.status === 'fulfilled' ? remindersResult.value : [];
    const emails = emailsResult.status === 'fulfilled' ? emailsResult.value : [];

    const briefing = await generateDailyBriefing(events, reminders, emails);

    // Persist to Supabase PostgreSQL
    await saveBriefingToDb(briefing);

    return NextResponse.json({
      success: true,
      briefing,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
