import { NextRequest, NextResponse } from 'next/server';
import { fetchLiveCalendarEvents, fetchLiveReminders } from '@/lib/caldav';
import { fetchRecentEmails, sendBriefingEmail } from '@/lib/gmail';
import { generateDailyBriefing } from '@/lib/gemini';
import { saveBriefingToDb, logSyncAudit } from '@/lib/db';
import { COOKIE_NAME, verifySessionToken } from '@/lib/auth';

export const maxDuration = 30; // Max execution timeout for Vercel Hobby serverless

export async function GET(req: NextRequest) {
  try {
    // 1. Verify Vercel Cron Secret / Sync Secret / Dashboard Session (when configured)
    const authHeader = req.headers.get('authorization');
    const querySecret = req.nextUrl.searchParams.get('secret');
    const cronSecret = process.env.CRON_SECRET || process.env.SYNC_SECRET;
    if (cronSecret) {
      const hasSecret =
        authHeader === `Bearer ${cronSecret}` ||
        querySecret === cronSecret ||
        (process.env.SYNC_SECRET && (authHeader === `Bearer ${process.env.SYNC_SECRET}` || querySecret === process.env.SYNC_SECRET));
      const dashPass = process.env.DASHBOARD_PASSWORD;
      const hasSession = dashPass ? await verifySessionToken(req.cookies.get(COOKIE_NAME)?.value, dashPass) : false;

      if (!hasSecret && !hasSession) {
        return NextResponse.json({ error: 'Unauthorized cron invocation' }, { status: 401 });
      }
    }

    console.log('[CRON] Starting automated 8:00 AM MYT Daily Briefing generation...');

    // 2. Fetch ground-truth data from Apple CalDAV and Gmail
    const [eventsResult, remindersResult, emailsResult] = await Promise.allSettled([
      fetchLiveCalendarEvents(14, 60),
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

    // 5. Dispatch automated 8:00 AM executive email briefing to user
    const recipient = process.env.USER_EMAIL || process.env.APPLE_ID || 'chriswonglihong@gmail.com';
    let emailDispatched = false;
    let emailError: string | undefined;

    try {
      const openReminders = reminders.filter(r => !r.isCompleted);
      await sendBriefingEmail(briefing, recipient, openReminders);
      emailDispatched = true;
      console.log(`[CRON] 8:00 AM briefing email successfully dispatched to ${recipient}`);
    } catch (err: any) {
      emailError = err.message;
      console.warn('[CRON] Could not dispatch email (requires gmail.send permission):', err.message);
    }

    // 6. Audit log
    await logSyncAudit('CRON_DAILY_BRIEFING', true, {
      briefingId: briefing.id,
      eventsCount: events.length,
      remindersCount: reminders.length,
      emailsCount: emails.length,
      emailDispatched,
      emailError,
    });

    console.log('[CRON] 8:00 AM MYT Daily Briefing successfully generated and persisted.');

    return NextResponse.json({
      success: true,
      message: '8:00 AM MYT Briefing generated successfully',
      briefingId: briefing.id,
      headline: briefing.headline,
      topPriorities: briefing.topPriorities,
      emailDispatched,
      emailError,
    });
  } catch (err: any) {
    console.error('[CRON ERROR]', err);
    await logSyncAudit('CRON_DAILY_BRIEFING', false, { error: err.message });
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
