import { NextResponse } from 'next/server';
import { fetchLiveCalendarEvents, fetchLiveReminders } from '@/lib/caldav';
import { fetchRecentEmailsWithStatus, getConnectedGoogleAccounts, hasGmailSendScope } from '@/lib/gmail';

export const maxDuration = 30;

export async function GET() {
  try {
    const [eventsResult, remindersResult, emailsResult, accountsResult, sendScopeResult] = await Promise.allSettled([
      fetchLiveCalendarEvents(14, 60),
      fetchLiveReminders(),
      fetchRecentEmailsWithStatus(10),
      getConnectedGoogleAccounts(),
      hasGmailSendScope(),
    ]);

    const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
    const reminders = remindersResult.status === 'fulfilled' ? remindersResult.value : [];
    const emailPayload = emailsResult.status === 'fulfilled' ? emailsResult.value : null;
    const emails = emailPayload ? emailPayload.threads : [];
    const failedAccounts = emailPayload ? emailPayload.failedAccounts : [];
    const gmailAccounts = accountsResult.status === 'fulfilled' ? accountsResult.value.map(a => a.email) : [];
    const emailSendReady = sendScopeResult.status === 'fulfilled' ? sendScopeResult.value : false;
    const allGmailAccountsFailed =
      emailsResult.status === 'rejected' ||
      (gmailAccounts.length > 0 && emails.length === 0 && failedAccounts.length >= gmailAccounts.length);

    const health = {
      appleCalendar: {
        status: eventsResult.status === 'fulfilled' ? 'OK' : 'ERROR',
        message: eventsResult.status === 'rejected' ? eventsResult.reason?.message : undefined,
      },
      appleReminders: {
        status: remindersResult.status === 'fulfilled' ? 'OK' : 'ERROR',
        message: remindersResult.status === 'rejected' ? remindersResult.reason?.message : undefined,
      },
      gmail: {
        status: allGmailAccountsFailed ? 'ERROR' : 'OK',
        message:
          emailsResult.status === 'rejected'
            ? emailsResult.reason?.message
            : allGmailAccountsFailed && failedAccounts.length > 0
            ? failedAccounts.map(f => `${f.email}: ${f.error}`).join('; ')
            : undefined,
        accounts: gmailAccounts,
        emailSendReady,
        failedAccounts: failedAccounts.length > 0 ? failedAccounts : undefined,
      },
      lastSync: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      data: {
        events,
        reminders,
        emails,
        health,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
