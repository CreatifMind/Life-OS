import { NextResponse } from 'next/server';
import { createAppleCalendarEvent, deleteAppleCalendarEventByUid } from '@/lib/caldav';

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

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, oldTitle, title, startTime, endTime, isAllDay, location, description, calendarName } = body || {};

    if (!id && !oldTitle) {
      return NextResponse.json({ success: false, error: 'Missing event id' }, { status: 400 });
    }
    if (!title || !String(title).trim() || !startTime) {
      return NextResponse.json({ success: false, error: 'Title and start time are required' }, { status: 400 });
    }

    const delResult = await deleteAppleCalendarEventByUid(String(id || ''), oldTitle ? String(oldTitle) : undefined);

    const startDate = new Date(startTime);
    const endDate = endTime ? new Date(endTime) : new Date(startDate.getTime() + 60 * 60 * 1000);

    const event = await createAppleCalendarEvent({
      title: String(title),
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      isAllDay: Boolean(isAllDay),
      location: location ? String(location) : undefined,
      description: description ? String(description) : undefined,
      calendarName: calendarName ? String(calendarName) : delResult.deletedCalendar,
    });

    return NextResponse.json({ success: true, event, deletedOld: delResult.deletedCount });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { id, title } = body || {};

    if (!id && !title) {
      return NextResponse.json({ success: false, error: 'Missing event id or title' }, { status: 400 });
    }

    const result = await deleteAppleCalendarEventByUid(String(id || ''), title ? String(title) : undefined);
    if (result.deletedCount === 0) {
      return NextResponse.json({ success: false, error: 'Event not found in Apple Calendar' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletedCount: result.deletedCount });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
