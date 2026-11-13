import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getAppSetting, saveAppSetting } from '@/lib/db';
import { fetchGoogleAccountEmail, saveConnectedGoogleAccount } from '@/lib/gmail';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(new URL(`/?auth=failed&error=${error || 'No code provided'}`, req.url));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${protocol}://${host}/api/auth/callback/google`;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId || '',
        client_secret: clientSecret || '',
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    const data = await tokenRes.json();

    if (data.error || !data.refresh_token) {
      console.error('OAuth token exchange error:', data);
      return NextResponse.redirect(
        new URL(`/?auth=failed&error=${encodeURIComponent(data.error_description || data.error || 'No refresh token returned')}`, req.url)
      );
    }

    const refreshToken = data.refresh_token;
    const grantedScopes = data.scope || '';
    const accountEmail = await fetchGoogleAccountEmail(data.access_token);

    // Save into multi-account store in Supabase (upserts by email without overwriting other accounts)
    await saveConnectedGoogleAccount(accountEmail, refreshToken);

    // Keep legacy GOOGLE_REFRESH_TOKEN populated if empty or single-account
    const existingLegacy = await getAppSetting('GOOGLE_REFRESH_TOKEN');
    if (!existingLegacy) {
      process.env.GOOGLE_REFRESH_TOKEN = refreshToken;
      await saveAppSetting('GOOGLE_REFRESH_TOKEN', refreshToken);

      try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
          let envContent = fs.readFileSync(envPath, 'utf8');
          if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
            envContent = envContent.replace(
              /GOOGLE_REFRESH_TOKEN=.*/,
              `GOOGLE_REFRESH_TOKEN="${refreshToken}"`
            );
          } else {
            envContent += `\nGOOGLE_REFRESH_TOKEN="${refreshToken}"\n`;
          }
          fs.writeFileSync(envPath, envContent, 'utf8');
          console.log('[AUTH] Successfully updated GOOGLE_REFRESH_TOKEN in .env.local');
        }
      } catch (fsErr) {
        console.warn('Could not update .env.local automatically (normal in serverless):', fsErr);
      }
    }

    const hasGmailScope = grantedScopes.includes('gmail.readonly');

    return NextResponse.redirect(
      new URL(`/?auth=gmail_success&account=${encodeURIComponent(accountEmail)}&scopes=${encodeURIComponent(grantedScopes)}&hasGmail=${hasGmailScope}`, req.url)
    );
  } catch (err: any) {
    console.error('Error exchanging Google authorization code:', err);
    return NextResponse.redirect(
      new URL(`/?auth=failed&error=${encodeURIComponent(err.message)}`, req.url)
    );
  }
}
