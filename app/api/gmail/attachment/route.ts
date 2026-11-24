import { NextRequest, NextResponse } from 'next/server';
import { fetchEmailAttachment } from '@/lib/gmail';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const messageId = req.nextUrl.searchParams.get('messageId');
    const attachmentId = req.nextUrl.searchParams.get('attachmentId');
    const account = req.nextUrl.searchParams.get('account') || undefined;
    const filename = req.nextUrl.searchParams.get('filename') || 'attachment';
    const mimeType = req.nextUrl.searchParams.get('mimeType') || 'application/octet-stream';

    if (!messageId || !attachmentId) {
      return NextResponse.json({ error: 'Missing messageId or attachmentId' }, { status: 400 });
    }

    const buffer = await fetchEmailAttachment(messageId, attachmentId, account);
    const safeFilename = filename.replace(/["\r\n]/g, '_');

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename="${safeFilename}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
