import { NextRequest, NextResponse } from 'next/server';
import { getConnectedGoogleAccounts, removeConnectedGoogleAccount } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const accounts = await getConnectedGoogleAccounts();
    return NextResponse.json({
      success: true,
      accounts: accounts.map(a => ({ email: a.email, addedAt: a.addedAt })),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const email = body?.email;
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ success: false, error: 'Missing email' }, { status: 400 });
    }

    const remaining = await removeConnectedGoogleAccount(email);
    return NextResponse.json({
      success: true,
      accounts: remaining.map(a => ({ email: a.email, addedAt: a.addedAt })),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
