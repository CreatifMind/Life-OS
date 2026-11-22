/**
 * Life OS — Gmail API Service
 * Handles OAuth refresh token rotation and fetches priority unread threads
 */

import { EmailThread, DailyBriefing, ConnectedGmailAccount, ReminderTask } from './types';
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

function stripAccountPrefix(id: string): { cleanId: string; inferredAccount?: string } {
  const idx = id.indexOf(':');
  if (idx > 0 && id.slice(0, idx).includes('@')) {
    return { cleanId: id.slice(idx + 1), inferredAccount: id.slice(0, idx) };
  }
  return { cleanId: id };
}

async function getAccessTokenForAccount(accountEmail?: string): Promise<{ accessToken: string; email: string }> {
  const accounts = await getConnectedGoogleAccounts();
  if (accounts.length === 0) {
    const token = await getFreshAccessToken();
    return { accessToken: token, email: accountEmail || 'Primary' };
  }
  const target = accountEmail
    ? accounts.find(a => a.email.toLowerCase() === accountEmail.toLowerCase()) || accounts[0]
    : accounts[0];
  const accessToken = await getFreshAccessToken(target.refreshToken);
  return { accessToken, email: target.email };
}

function decodeBase64Url(data?: string): string {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractBodyFromPayload(payload: any): string {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data).trim();
  }

  if (Array.isArray(payload.parts)) {
    // Prefer text/plain first
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data).trim();
      }
      if (part.parts) {
        const nested = extractBodyFromPayload(part);
        if (nested) return nested;
      }
    }
    // Fallback to text/html
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return htmlToPlainText(decodeBase64Url(part.body.data));
      }
    }
  }

  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return htmlToPlainText(decodeBase64Url(payload.body.data));
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data).trim();
  }

  return '';
}

export interface EmailDetail {
  id: string;
  threadId: string;
  accountEmail: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  to: string;
  date: string;
  messageIdHeader?: string;
  body: string;
  snippet: string;
}

export async function fetchEmailDetail(rawId: string, accountEmail?: string): Promise<EmailDetail> {
  const { cleanId, inferredAccount } = stripAccountPrefix(rawId);
  const { accessToken, email } = await getAccessTokenForAccount(accountEmail || inferredAccount);

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(cleanId)}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const msg = await res.json();
  if (msg.error) {
    throw new Error(`Gmail fetch error (${msg.error.code}): ${msg.error.message}`);
  }

  const headers = msg.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const from = getHeader('From') || 'Unknown';
  let senderName = from;
  let senderEmail = from;
  const emailMatch = /<([^>]+)>/.exec(from);
  if (emailMatch) {
    senderEmail = emailMatch[1];
    senderName = from.replace(emailMatch[0], '').trim().replace(/^"|"$/g, '');
  }

  const body = extractBodyFromPayload(msg.payload) || msg.snippet || '(Empty message)';

  return {
    id: rawId,
    threadId: msg.threadId || cleanId,
    accountEmail: email,
    subject: getHeader('Subject') || '(No Subject)',
    senderName: senderName || senderEmail,
    senderEmail,
    to: getHeader('To'),
    date: getHeader('Date') || new Date().toISOString(),
    messageIdHeader: getHeader('Message-ID') || undefined,
    body,
    snippet: msg.snippet || '',
  };
}

export async function modifyEmailLabels(
  rawId: string,
  accountEmail: string | undefined,
  removeLabelIds: string[]
): Promise<boolean> {
  const { cleanId, inferredAccount } = stripAccountPrefix(rawId);
  const { accessToken } = await getAccessTokenForAccount(accountEmail || inferredAccount);

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(cleanId)}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ removeLabelIds }),
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`Gmail modify error (${data.error.code}): ${data.error.message}`);
  }
  return true;
}

export async function replyToEmail(params: {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  accountEmail?: string;
}): Promise<boolean> {
  const { accessToken } = await getAccessTokenForAccount(params.accountEmail);
  const replySubject = /^re:/i.test(params.subject) ? params.subject : `Re: ${params.subject}`;

  const lines = [
    `To: ${params.to}`,
    `Subject: =?utf-8?B?${Buffer.from(replySubject).toString('base64')}?=`,
    ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`, `References: ${params.inReplyTo}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    params.body,
  ];

  const encodedMessage = Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: encodedMessage,
      threadId: params.threadId,
    }),
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`Gmail reply error (${data.error.code}): ${data.error.message}`);
  }
  return true;
}

async function fetchEmailsForAccount(account: ConnectedGmailAccount, maxResults: number): Promise<EmailThread[]> {
  const accessToken = await getFreshAccessToken(account.refreshToken);

  const query = encodeURIComponent('in:inbox category:primary is:unread');
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

    const decodeEntities = (s: string) =>
      s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    threads.push({
      id: `${account.email}:${item.id}`,
      threadId: item.threadId,
      accountEmail: account.email,
      senderName: senderName || senderEmail,
      senderEmail,
      subject,
      receivedAt: new Date(date).toISOString(),
      snippet: decodeEntities(msg.snippet || ''),
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

function toBulletLines(text: string): string[] {
  if (!text) return [];
  const byNewline = text
    .split('\n')
    .map(l => l.replace(/^[\s•\-*]+/, '').trim())
    .filter(Boolean);
  if (byNewline.length > 1) return byNewline;
  return text
    .split(/(?<=[.!?])\s+/)
    .map(l => l.replace(/^[\s•\-*]+/, '').trim())
    .filter(Boolean);
}

export async function sendBriefingEmail(
  briefing: DailyBriefing,
  recipientEmail: string,
  openReminders: ReminderTask[] = []
): Promise<boolean> {
  const accessToken = await getFreshAccessToken();

  const formattedDate = new Date(briefing.generatedAt).toLocaleDateString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const subject = `Life OS • ${formattedDate}`;
  const scheduleBullets = toBulletLines(briefing.agendaSummary);
  const focusText = briefing.suggestedPreparation || briefing.headline;

  const taskBullets = openReminders.slice(0, 8).map(t => {
    let dueLabel = '';
    if (t.dueDate) {
      const dueStr = new Date(t.dueDate).toLocaleDateString('en-MY', {
        timeZone: 'Asia/Kuala_Lumpur',
        day: 'numeric',
        month: 'short',
      });
      dueLabel = ` <span style="color: #71717a;">(${dueStr})</span>`;
    }
    return `${t.title}${dueLabel}`;
  });

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #18181b; border: 1px solid #27272a; border-radius: 14px; overflow: hidden;">
          <tr>
            <td style="padding: 18px 24px; border-bottom: 1px solid #27272a;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #818cf8; text-transform: uppercase;">LIFE OS • ${formattedDate}</span>
                  </td>
                  <td align="right">
                    <a href="https://life-os-xi-drab.vercel.app" style="display: inline-block; padding: 6px 12px; background-color: #4f46e5; color: #ffffff; text-decoration: none; font-size: 11px; font-weight: 600; border-radius: 6px;">Open →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 24px;">
              <!-- Focus -->
              <div style="margin-bottom: 18px; padding: 10px 14px; background-color: rgba(79, 70, 229, 0.12); border-left: 3px solid #818cf8; border-radius: 6px;">
                <span style="font-size: 10px; font-weight: 700; color: #818cf8; text-transform: uppercase; letter-spacing: 0.06em;">Focus</span>
                <p style="margin: 4px 0 0 0; font-size: 13px; color: #f4f4f5; font-weight: 500;">${focusText}</p>
              </div>

              <!-- Priorities -->
              <span style="font-size: 10px; font-weight: 700; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.06em;">Priorities</span>
              <ul style="margin: 6px 0 18px 0; padding-left: 18px; font-size: 13px; line-height: 1.6; color: #e4e4e7;">
                ${briefing.topPriorities.map(p => `<li style="margin-bottom: 4px;"><strong style="color: #ffffff;">${p.title}</strong> <span style="color: #a1a1aa;">— ${p.reason}</span></li>`).join('')}
              </ul>

              <!-- Important Tasks -->
              <span style="font-size: 10px; font-weight: 700; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.06em;">Important Tasks</span>
              <ul style="margin: 6px 0 18px 0; padding-left: 18px; font-size: 13px; line-height: 1.6; color: #e4e4e7;">
                ${taskBullets.length > 0 ? taskBullets.map(t => `<li style="margin-bottom: 3px;">${t}</li>`).join('') : '<li style="color: #71717a;">No open tasks</li>'}
              </ul>

              <!-- Schedule -->
              <span style="font-size: 10px; font-weight: 700; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.06em;">Schedule</span>
              <ul style="margin: 6px 0 0 0; padding-left: 18px; font-size: 13px; line-height: 1.6; color: #e4e4e7;">
                ${scheduleBullets.length > 0 ? scheduleBullets.map(s => `<li style="margin-bottom: 3px;">${s}</li>`).join('') : '<li style="color: #71717a;">No scheduled events</li>'}
              </ul>
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
