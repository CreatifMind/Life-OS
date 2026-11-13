import { NextResponse } from 'next/server';
import { fetchLiveCalendarEvents, fetchLiveReminders } from '@/lib/caldav';
import { fetchRecentEmails, getConnectedGoogleAccounts } from '@/lib/gmail';

export const maxDuration = 30;

export async function GET() {
  try {
    const [eventsResult, remindersResult, emailsResult, accountsResult] = await Promise.allSettled([
      fetchLiveCalendarEvents(),
      fetchLiveReminders(),
      fetchRecentEmails(10),
      getConnectedGoogleAccounts(),
    ]);

    const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
    const reminders = remindersResult.status === 'fulfilled' ? remindersResult.value : [];
    const emails = emailsResult.status === 'fulfilled' ? emailsResult.value : [];
    const gmailAccounts = accountsResult.status === 'fulfilled' ? accountsResult.value.map(a => a.email) : [];

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
        status: emailsResult.status === 'fulfilled' ? 'OK' : 'ERROR',
        message: emailsResult.status === 'rejected' ? emailsResult.reason?.message : undefined,
        accounts: gmailAccounts,
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
