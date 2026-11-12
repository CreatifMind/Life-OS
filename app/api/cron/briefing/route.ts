import { NextRequest, NextResponse } from 'next/server';
import { fetchLiveCalendarEvents, fetchLiveReminders } from '@/lib/caldav';
import { fetchRecentEmails } from '@/lib/gmail';
import { generateDailyBriefing } from '@/lib/gemini';
import { saveBriefingToDb, logSyncAudit } from '@/lib/db';

export const maxDuration = 30; // Max execution timeout for Vercel Hobby serverless

export async function GET(req: NextRequest) {
  try {
    // 1. Verify Vercel Cron Secret (if configured)
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized cron invocation' }, { status: 401 });
    }

    console.log('[CRON] Starting automated 8:00 AM MYT Daily Briefing generation...');

    // 2. Fetch ground-truth data from Apple CalDAV and Gmail
    const [eventsResult, remindersResult, emailsResult] = await Promise.allSettled([
      fetchLiveCalendarEvents(),
      fetchLiveReminders(),
      fetchRecentEmails(10),
    ]);

    const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
    const reminders = remindersResult.status === 'fulfilled' ? remindersResult.value : [];
    const emails = emailsResult.status === 'fulfilled' ? emailsResult.value : [];

    // 3. Synthesize executive briefing with Gemini AI
    const briefing = await generateDailyBriefing(events, reminders, emails);

    // 4. Persist to Supabase PostgreSQL
    await saveBriefingToDb(briefing);

    // 5. Audit log
    await logSyncAudit('CRON_DAILY_BRIEFING', true, {
      briefingId: briefing.id,
      eventsCount: events.length,
      remindersCount: reminders.length,
      emailsCount: emails.length,
    });

    console.log('[CRON] 8:00 AM MYT Daily Briefing successfully generated and persisted.');

    return NextResponse.json({
      success: true,
      message: '8:00 AM MYT Briefing generated successfully',
      briefingId: briefing.id,
      headline: briefing.headline,
      topPriorities: briefing.topPriorities,
    });
  } catch (err: any) {
    console.error('[CRON ERROR]', err);
    await logSyncAudit('CRON_DAILY_BRIEFING', false, { error: err.message });
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
