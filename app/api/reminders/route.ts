import { NextResponse } from 'next/server';
import { createAppleReminder, markAppleReminderComplete, fetchLiveReminders } from '@/lib/caldav';

export async function GET() {
  try {
    const reminders = await fetchLiveReminders();
    return NextResponse.json({ success: true, reminders });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, listName, dueDate, notes } = body;

    if (!title) {
      return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 });
    }

    const uid = await createAppleReminder(title, listName, dueDate, notes);
    return NextResponse.json({ success: true, uid });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { uid, isCompleted } = body;

    if (!uid) {
      return NextResponse.json({ success: false, error: 'Task UID is required' }, { status: 400 });
    }

    await markAppleReminderComplete(uid, Boolean(isCompleted));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
