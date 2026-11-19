import { NextRequest, NextResponse } from 'next/server';
import { fetchEmailDetail, modifyEmailLabels, replyToEmail } from '@/lib/gmail';
import { callGemini } from '@/lib/gemini';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    const account = req.nextUrl.searchParams.get('account') || undefined;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing email id' }, { status: 400 });
    }

    const detail = await fetchEmailDetail(id, account);
    return NextResponse.json({ success: true, detail });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, id, accountEmail, threadId, to, subject, replyBody, inReplyTo, emailBody, senderName } = body || {};

    if (action === 'markRead') {
      if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
      await modifyEmailLabels(id, accountEmail, ['UNREAD']);
      return NextResponse.json({ success: true });
    }

    if (action === 'archive') {
      if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
      await modifyEmailLabels(id, accountEmail, ['UNREAD', 'INBOX']);
      return NextResponse.json({ success: true });
    }

    if (action === 'reply') {
      if (!threadId || !to || !replyBody?.trim()) {
        return NextResponse.json({ success: false, error: 'Missing threadId, to, or replyBody' }, { status: 400 });
      }
      await replyToEmail({
        threadId,
        to,
        subject: subject || '(No Subject)',
        body: replyBody.trim(),
        inReplyTo,
        accountEmail,
      });
      if (id) {
        try {
          await modifyEmailLabels(id, accountEmail, ['UNREAD']);
        } catch {
          // Non-fatal if gmail.modify isn't granted yet
        }
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'draftReply') {
      const userName = process.env.USER_NAME || 'Chris';
      const prompt = `Draft a concise, polite, professional email reply from ${userName} to the email below.
Keep it short (2-5 sentences), natural, and ready to send. Do NOT include a subject line or markdown fences — just the reply body text.

From: ${senderName || to || 'Sender'}
Subject: ${subject || '(No Subject)'}
Email content:
${String(emailBody || '').slice(0, 2500)}

Reply body:`;
      const draft = await callGemini(prompt, 'text/plain');
      return NextResponse.json({ success: true, draft: draft.trim() });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
