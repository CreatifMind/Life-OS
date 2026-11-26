import { NextResponse } from 'next/server';
import {
  createAppleCalendarEvent,
  deleteAppleCalendarEventByUid,
  updateAppleCalendarEvent,
} from '@/lib/caldav';

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, startTime, endTime, startDate, endDate, isAllDay, location, description, calendarName } = body || {};

    if (!title || !String(title).trim()) {
      return NextResponse.json({ success: false, error: 'Event title is required' }, { status: 400 });
    }
    if (!startTime && !startDate) {
      return NextResponse.json({ success: false, error: 'Start time or start date is required' }, { status: 400 });
    }

    const startDateObj = startTime ? new Date(startTime) : new Date(`${startDate}T00:00:00+08:00`);
    const endDateObj = endTime
      ? new Date(endTime)
      : new Date(startDateObj.getTime() + 60 * 60 * 1000);

    const event = await createAppleCalendarEvent({
      title: String(title),
      startTime: startDateObj.toISOString(),
      endTime: endDateObj.toISOString(),
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
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
    const {
      id,
      oldTitle,
      isRecurring,
      title,
      startTime,
      endTime,
      startDate,
      endDate,
      isAllDay,
      location,
      description,
      calendarName,
    } = body || {};

    if (isRecurring) {
      return NextResponse.json(
        { success: false, error: 'Recurring events are read-only in Life OS. Edit the series in Apple Calendar.' },
        { status: 400 }
      );
    }
    if (!id && !oldTitle) {
      return NextResponse.json({ success: false, error: 'Missing event id' }, { status: 400 });
    }
    if (!title || !String(title).trim() || (!startTime && !startDate)) {
      return NextResponse.json({ success: false, error: 'Title and start date/time are required' }, { status: 400 });
    }

    const startDateObj = startTime ? new Date(startTime) : new Date(`${startDate}T00:00:00+08:00`);
    const endDateObj = endTime
      ? new Date(endTime)
      : new Date(startDateObj.getTime() + 60 * 60 * 1000);

    const { event, deletedOld } = await updateAppleCalendarEvent({
      uid: id ? String(id) : undefined,
      oldTitle: oldTitle ? String(oldTitle) : undefined,
      title: String(title),
      startTime: startDateObj.toISOString(),
      endTime: endDateObj.toISOString(),
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      isAllDay: Boolean(isAllDay),
      location: location ? String(location) : undefined,
      description: description ? String(description) : undefined,
      calendarName: calendarName ? String(calendarName) : undefined,
    });

    return NextResponse.json({ success: true, event, deletedOld });
  } catch (err: any) {
    const status = /recurring/i.test(err?.message || '') ? 400 : 500;
    return NextResponse.json({ success: false, error: err.message }, { status });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { id, title, isRecurring } = body || {};

    if (isRecurring) {
      return NextResponse.json(
        { success: false, error: 'Recurring events cannot be deleted from Life OS. Delete the series in Apple Calendar.' },
        { status: 400 }
      );
    }
    if (!id && !title) {
      return NextResponse.json({ success: false, error: 'Missing event id or title' }, { status: 400 });
    }

    const result = await deleteAppleCalendarEventByUid(String(id || ''), title ? String(title) : undefined);
    if (result.skippedRecurring) {
      return NextResponse.json(
        { success: false, error: 'Recurring events cannot be deleted from Life OS. Delete the series in Apple Calendar.' },
        { status: 400 }
      );
    }
    if (result.deletedCount === 0) {
      return NextResponse.json({ success: false, error: 'Event not found in Apple Calendar' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletedCount: result.deletedCount });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
