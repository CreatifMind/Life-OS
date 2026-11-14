import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, createSessionToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const expectedPassword = process.env.DASHBOARD_PASSWORD;
    if (!expectedPassword) {
      return NextResponse.json({ success: true });
    }

    const body = await req.json();
    const password = typeof body?.password === 'string' ? body.password : '';
    const rememberMe = body?.rememberMe !== false;

    if (password !== expectedPassword) {
      return NextResponse.json(
        { success: false, error: 'Incorrect passcode' },
        { status: 401 }
      );
    }

    const token = await createSessionToken(expectedPassword);
    const res = NextResponse.json({ success: true });

    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      ...(rememberMe ? { maxAge: 60 * 60 * 24 * 365 } : {}),
    });

    return res;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
}
