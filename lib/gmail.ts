/**
 * Life OS — Gmail API Service
 * Handles OAuth refresh token rotation and fetches priority unread threads
 */

import { EmailThread, DailyBriefing, ConnectedGmailAccount } from './types';
import { getAppSetting, saveAppSetting } from './db';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || '';

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function fetchGoogleAccountEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const info = await res.json();
      if (info.email) return String(info.email).toLowerCase();
    }
  } catch {}

  try {
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      if (profile.emailAddress) return String(profile.emailAddress).toLowerCase();
    }
  } catch {}

  return 'Primary';
}

export async function getConnectedGoogleAccounts(): Promise<ConnectedGmailAccount[]> {
  const raw = await getAppSetting('GOOGLE_ACCOUNTS');
  let accounts: ConnectedGmailAccount[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        accounts = parsed.filter((a: any) => a && typeof a.email === 'string' && typeof a.refreshToken === 'string');
      }
    } catch {}
  }

  // Backward-compatibility: include legacy GOOGLE_REFRESH_TOKEN if not already represented
  const legacyDbToken = await getAppSetting('GOOGLE_REFRESH_TOKEN');
  const legacyToken = legacyDbToken || process.env.GOOGLE_REFRESH_TOKEN || REFRESH_TOKEN;
  if (legacyToken && !accounts.some(a => a.refreshToken === legacyToken)) {
    let email = 'Primary';
    try {
      const accessToken = await getFreshAccessToken(legacyToken);
      email = await fetchGoogleAccountEmail(accessToken);
    } catch {}

    if (!accounts.some(a => a.email.toLowerCase() === email.toLowerCase())) {
      accounts.unshift({
        email,
        refreshToken: legacyToken,
        addedAt: new Date().toISOString(),
      });
      if (email !== 'Primary') {
        await saveAppSetting('GOOGLE_ACCOUNTS', JSON.stringify(accounts));
      }
    }
  }

  return accounts;
}

export async function saveConnectedGoogleAccount(email: string, refreshToken: string): Promise<ConnectedGmailAccount[]> {
  const normalizedEmail = email.trim().toLowerCase();
  const accounts = await getConnectedGoogleAccounts();
  const existingIdx = accounts.findIndex(a => a.email.toLowerCase() === normalizedEmail);
  const entry: ConnectedGmailAccount = {
    email: normalizedEmail,
    refreshToken,
    addedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    accounts[existingIdx] = entry;
  } else {
    accounts.push(entry);
  }

  await saveAppSetting('GOOGLE_ACCOUNTS', JSON.stringify(accounts));
  return accounts;
}

export async function removeConnectedGoogleAccount(email: string): Promise<ConnectedGmailAccount[]> {
  const normalizedEmail = email.trim().toLowerCase();
  const accounts = await getConnectedGoogleAccounts();
  const filtered = accounts.filter(a => a.email.toLowerCase() !== normalizedEmail);
  await saveAppSetting('GOOGLE_ACCOUNTS', JSON.stringify(filtered));

  // If the removed account was using the legacy GOOGLE_REFRESH_TOKEN, update/clear it so it doesn't resurrect
  const legacyDbToken = await getAppSetting('GOOGLE_REFRESH_TOKEN');
  const removed = accounts.find(a => a.email.toLowerCase() === normalizedEmail);
  if (removed && legacyDbToken === removed.refreshToken) {
    await saveAppSetting('GOOGLE_REFRESH_TOKEN', filtered[0]?.refreshToken || '');
  }

  return filtered;
}

export async function getFreshAccessToken(refreshTokenOverride?: string): Promise<string> {
  let activeRefreshToken = refreshTokenOverride;

  if (!activeRefreshToken) {
    const raw = await getAppSetting('GOOGLE_ACCOUNTS');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed[0]?.refreshToken) {
          activeRefreshToken = parsed[0].refreshToken;
        }
      } catch {}
    }
  }

  if (!activeRefreshToken) {
    const dbToken = await getAppSetting('GOOGLE_REFRESH_TOKEN');
    activeRefreshToken = dbToken || process.env.GOOGLE_REFRESH_TOKEN || REFRESH_TOKEN;
  }

  if (!activeRefreshToken || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Missing Google OAuth credentials in environment or database');
  }

  const cached = tokenCache.get(activeRefreshToken);
  if (cached && Date.now() < cached.expiresAt - 60000) {
    return cached.token;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: activeRefreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (data.error || !data.access_token) {
    throw new Error(`Failed to refresh Google access token: ${data.error_description || data.error}`);
  }

  tokenCache.set(activeRefreshToken, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  });

  return data.access_token;
}

export async function hasGmailSendScope(): Promise<boolean> {
  try {
    const accessToken = await getFreshAccessToken();
    const res = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    if (!res.ok) return false;
    const info = await res.json();
    const scopeStr = String(info.scope || '');
    return scopeStr.includes('gmail.send');
  } catch {
    return false;
  }
}

async function fetchEmailsForAccount(account: ConnectedGmailAccount, maxResults: number): Promise<EmailThread[]> {
  const accessToken = await getFreshAccessToken(account.refreshToken);

  const query = encodeURIComponent('is:unread');
  const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const listData = await listRes.json();
  if (listData.error) {
    throw new Error(`Gmail API error (${account.email}): ${listData.error.message}`);
  }
  const messages = listData.messages || [];
  const threads: EmailThread[] = [];

  for (const item of messages) {
    const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!msgRes.ok) continue;

    const msg = await msgRes.json();
    const headers = msg.payload?.headers || [];

    const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
    const from = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown';
    const date = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date().toISOString();

    let senderName = from;
    let senderEmail = from;
    const emailMatch = /<([^>]+)>/.exec(from);
    if (emailMatch) {
      senderEmail = emailMatch[1];
      senderName = from.replace(emailMatch[0], '').trim().replace(/^"|"$/g, '');
    }

    const isImportant = (msg.labelIds || []).includes('IMPORTANT');
    const isUnread = (msg.labelIds || []).includes('UNREAD');

    threads.push({
      id: `${account.email}:${item.id}`,
      threadId: item.threadId,
      accountEmail: account.email,
      senderName: senderName || senderEmail,
      senderEmail,
      subject,
      receivedAt: new Date(date).toISOString(),
      snippet: msg.snippet || '',
      isUnread,
      isImportant,
    });
  }

  return threads;
}

export async function fetchRecentEmails(maxResults = 10): Promise<EmailThread[]> {
  try {
    const accounts = await getConnectedGoogleAccounts();
    if (accounts.length === 0) {
      throw new Error('No Google accounts connected');
    }

    const perAccountLimit = accounts.length > 1 ? Math.max(5, Math.ceil(maxResults / accounts.length) + 2) : maxResults;
    const results = await Promise.allSettled(
      accounts.map(acc => fetchEmailsForAccount(acc, perAccountLimit))
    );

    const allThreads: EmailThread[] = [];
    const errors: string[] = [];

    for (const res of results) {
      if (res.status === 'fulfilled') {
        allThreads.push(...res.value);
      } else {
        errors.push(res.reason?.message || 'Failed to fetch account');
      }
    }

    if (allThreads.length === 0 && errors.length === accounts.length) {
      throw new Error(errors.join('; '));
    }

    return allThreads
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
      .slice(0, Math.max(maxResults, 15));
  } catch (err: any) {
    console.error('Error fetching emails from Gmail:', err.message);
    throw err;
  }
}

export async function sendBriefingEmail(briefing: DailyBriefing, recipientEmail: string): Promise<boolean> {
  const accessToken = await getFreshAccessToken();

  const formattedDate = new Date(briefing.generatedAt).toLocaleDateString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const subject = `☕ Executive Daily Briefing — ${formattedDate}`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
          
          <!-- Header Bar -->
          <tr>
            <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #27272a;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #818cf8; text-transform: uppercase;">✦ LIFE OS EXECUTIVE BRIEFING</span>
                    <h1 style="margin: 6px 0 0 0; font-size: 18px; font-weight: 600; color: #ffffff;">Operational Briefing</h1>
                    <span style="font-size: 12px; color: #71717a;">${formattedDate} • 8:00 AM MYT</span>
                  </td>
                  <td align="right" valign="top">
                    <a href="https://life-os-xi-drab.vercel.app" style="display: inline-block; padding: 8px 14px; background-color: #4f46e5; color: #ffffff; text-decoration: none; font-size: 11px; font-weight: 600; border-radius: 8px;">Open Life OS →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Executive Headline -->
          <tr>
            <td style="padding: 24px 32px; background: linear-gradient(180deg, rgba(79, 70, 229, 0.08) 0%, rgba(24, 24, 27, 0) 100%);">
              <span style="font-size: 11px; font-weight: 600; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 8px;">Executive Summary</span>
              <p style="margin: 0; font-size: 16px; line-height: 1.5; color: #f4f4f5; font-weight: 500;">
                "${briefing.headline}"
              </p>
            </td>
          </tr>

          <!-- Top 3 Priorities -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #818cf8; text-transform: uppercase; display: block; margin-bottom: 12px;">Top 3 Priorities Today</span>
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                ${briefing.topPriorities.map(p => `
                  <tr>
                    <td style="padding: 12px; background-color: #09090b; border: 1px solid #27272a; border-radius: 10px;">
                      <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                          <td width="24" valign="top">
                            <span style="display: inline-block; width: 20px; height: 20px; background-color: #27272a; color: #a1a1aa; text-align: center; line-height: 20px; border-radius: 50%; font-size: 11px; font-weight: 600;">${p.rank}</span>
                          </td>
                          <td style="padding-left: 10px;">
                            <span style="font-size: 13px; font-weight: 600; color: #ffffff;">${p.title}</span>
                            <span style="display: inline-block; margin-left: 6px; padding: 2px 6px; font-size: 9px; font-weight: 600; border-radius: 4px; background-color: #27272a; color: #818cf8; text-transform: uppercase;">${p.source}</span>
                            <p style="margin: 4px 0 0 0; font-size: 11px; line-height: 1.4; color: #a1a1aa;">${p.reason}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr><td height="8"></td></tr>
                `).join('')}
              </table>
            </td>
          </tr>

          <!-- Schedule & Intelligence Grid -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <!-- Schedule Flow -->
                  <td width="48%" valign="top" style="padding: 14px; background-color: #09090b; border: 1px solid #27272a; border-radius: 10px;">
                    <span style="font-size: 10px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 6px;">Today's Schedule</span>
                    <p style="margin: 0; font-size: 11px; line-height: 1.5; color: #d4d4d8;">${briefing.agendaSummary}</p>
                  </td>
                  <td width="4%"></td>
                  <!-- Email Intelligence -->
                  <td width="48%" valign="top" style="padding: 14px; background-color: #09090b; border: 1px solid #27272a; border-radius: 10px;">
                    <span style="font-size: 10px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 6px;">Inbox Intelligence</span>
                    <p style="margin: 0; font-size: 11px; line-height: 1.5; color: #d4d4d8;">${briefing.emailHighlights}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${briefing.suggestedPreparation ? `
          <!-- Strategic Focus -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              <div style="padding: 12px 16px; background-color: rgba(79, 70, 229, 0.1); border: 1px solid rgba(79, 70, 229, 0.25); border-radius: 10px;">
                <span style="font-size: 10px; font-weight: 700; color: #818cf8; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 4px;">Strategic Focus</span>
                <p style="margin: 0; font-size: 12px; line-height: 1.4; color: #e0e7ff;">${briefing.suggestedPreparation}</p>
              </div>
            </td>
          </tr>
          ` : ''}

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; border-top: 1px solid #27272a; text-align: center; background-color: #09090b;">
              <p style="margin: 0 0 8px 0; font-size: 11px; color: #71717a;">
                Life OS Executive Intelligence • Auto-dispatched at 8:00 AM MYT
              </p>
              <a href="https://life-os-xi-drab.vercel.app" style="font-size: 11px; color: #818cf8; text-decoration: none;">Launch Life OS Dashboard</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const rawMessage = [
    `To: ${recipientEmail}`,
    `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
  ].join('\r\n');

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encodedMessage }),
  });

  const sendData = await sendRes.json();
  if (sendData.error) {
    throw new Error(`Gmail send error (${sendData.error.code}): ${sendData.error.message}`);
  }

  return true;
}
