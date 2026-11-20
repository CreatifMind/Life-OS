import { NextResponse } from 'next/server';
import { createAppleCalendarEvent } from '@/lib/caldav';

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, startTime, endTime, isAllDay, location, description, calendarName } = body || {};

    if (!title || !String(title).trim()) {
      return NextResponse.json({ success: false, error: 'Event title is required' }, { status: 400 });
    }
    if (!startTime) {
      return NextResponse.json({ success: false, error: 'Start time is required' }, { status: 400 });
    }

    const startDate = new Date(startTime);
    const endDate = endTime ? new Date(endTime) : new Date(startDate.getTime() + 60 * 60 * 1000);

    const event = await createAppleCalendarEvent({
      title: String(title),
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      isAllDay: Boolean(isAllDay),
      location: location ? String(location) : undefined,
      description: description ? String(description) : undefined,
      calendarName: calendarName ? String(calendarName) : undefined,
    });

    return NextResponse.json({ success: true, event });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
