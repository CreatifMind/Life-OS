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
  let shouldPersistCleanup = false;

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const seen = new Set<string>();
        const cleaned: ConnectedGmailAccount[] = [];
        for (const a of parsed) {
          if (!a || typeof a.email !== 'string' || typeof a.refreshToken !== 'string') {
            shouldPersistCleanup = true;
            continue;
          }
          const email = a.email.trim().toLowerCase();
          // Purge corrupt 'Primary' or non-email placeholder entries
          if (!email.includes('@') || !a.refreshToken) {
            shouldPersistCleanup = true;
            continue;
          }
          if (seen.has(email)) {
            shouldPersistCleanup = true;
            const idx = cleaned.findIndex(item => item.email.toLowerCase() === email);
            if (idx >= 0) cleaned[idx] = { ...a, email };
            continue;
          }
          seen.add(email);
          cleaned.push({ ...a, email });
        }
        accounts = cleaned;
      }
    } catch {}
  }

  // Backward-compatibility: only promote legacy GOOGLE_REFRESH_TOKEN if it actually refreshes to a real email
  const legacyDbToken = await getAppSetting('GOOGLE_REFRESH_TOKEN');
  const legacyToken = legacyDbToken || process.env.GOOGLE_REFRESH_TOKEN || REFRESH_TOKEN;
  if (legacyToken && !accounts.some(a => a.refreshToken === legacyToken)) {
    try {
      const accessToken = await getFreshAccessToken(legacyToken);
      const resolvedEmail = (await fetchGoogleAccountEmail(accessToken)).trim().toLowerCase();
      if (resolvedEmail.includes('@') && !accounts.some(a => a.email.toLowerCase() === resolvedEmail)) {
        accounts.unshift({
          email: resolvedEmail,
          refreshToken: legacyToken,
          addedAt: new Date().toISOString(),
        });
        shouldPersistCleanup = true;
      }
    } catch {
      // Legacy token is expired/invalid; never re-inject as a fake 'Primary' account
    }
  }

  if (shouldPersistCleanup) {
    await saveAppSetting('GOOGLE_ACCOUNTS', JSON.stringify(accounts));
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
        if (Array.isArray(parsed)) {
          const valid = parsed.find(
            (a: any) => a && typeof a.email === 'string' && a.email.includes('@') && typeof a.refreshToken === 'string' && a.refreshToken
          );
          if (valid?.refreshToken) {
            activeRefreshToken = valid.refreshToken;
          }
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
    signal: AbortSignal.timeout(10000),
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
    const accounts = await getConnectedGoogleAccounts();
    const checkToken = async (token: string) => {
      const res = await fetch(
        `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!res.ok) return false;
      const info = await res.json();
      return String(info.scope || '').includes('gmail.send');
    };

    if (accounts.length === 0) {
      const accessToken = await getFreshAccessToken();
      return checkToken(accessToken);
    }

    const checks = await Promise.allSettled(
      accounts.map(async acc => {
        const tok = await getFreshAccessToken(acc.refreshToken);
        return checkToken(tok);
      })
    );

    const results = checks.map(c => (c.status === 'fulfilled' ? c.value : false));
    return results.some(Boolean);
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

function extractHtmlFromPayload(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      if (part.parts) {
        const nested = extractHtmlFromPayload(part);
        if (nested) return nested;
      }
    }
  }
  return '';
}

export interface EmailAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
}

function extractAttachmentsFromPayload(payload: any, acc: EmailAttachment[] = []): EmailAttachment[] {
  if (!payload) return acc;
  if (payload.body?.attachmentId) {
    const partHeaders = payload.headers || [];
    const cidHeader = partHeaders.find((h: any) => h.name.toLowerCase() === 'content-id')?.value || '';
    const contentId = cidHeader.replace(/^<|>$/g, '').trim() || undefined;
    acc.push({
      attachmentId: payload.body.attachmentId,
      filename: payload.filename || (contentId ? `${contentId}.bin` : 'attachment'),
      mimeType: payload.mimeType || 'application/octet-stream',
      size: payload.body.size || 0,
      contentId,
    });
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      extractAttachmentsFromPayload(part, acc);
    }
  }
  return acc;
}

function sanitizeEmailHtml(html: string, rawMessageId: string, accountEmail: string, attachments: EmailAttachment[]): string {
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"')
    .replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'")
    .replace(/\btarget\s*=\s*["']_(?:self|parent|top)["']/gi, 'target="_blank" rel="noopener noreferrer"');

  // Rewrite inline cid: image references to our authenticated attachment proxy route
  for (const att of attachments) {
    if (att.contentId) {
      const proxyUrl = `/api/gmail/attachment?messageId=${encodeURIComponent(rawMessageId)}&attachmentId=${encodeURIComponent(att.attachmentId)}&account=${encodeURIComponent(accountEmail)}&mimeType=${encodeURIComponent(att.mimeType)}&filename=${encodeURIComponent(att.filename)}`;
      clean = clean.replace(new RegExp(`cid:${att.contentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), proxyUrl);
    }
  }

  const headInject = `<meta name="viewport" content="width=device-width, initial-scale=1.0" /><base target="_blank" /><style>html,body{margin:0;padding:16px;max-width:100%!important;overflow-x:hidden!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5;color:#18181b;background:#ffffff;word-wrap:break-word;overflow-wrap:break-word;box-sizing:border-box;}*,*::before,*::after{box-sizing:border-box!important;}table,tbody,tr,td,div,section,center{max-width:100%!important;}table{width:auto!important;}img{max-width:100%!important;height:auto!important;}a{color:#2563eb;}</style>`;
  if (/<head[^>]*>/i.test(clean)) {
    return clean.replace(/<head([^>]*)>/i, `<head$1>${headInject}`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />${headInject}</head><body>${clean}</body></html>`;
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
  htmlBody?: string;
  attachments: EmailAttachment[];
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
  const allAttachments = extractAttachmentsFromPayload(msg.payload);
  const rawHtml = extractHtmlFromPayload(msg.payload);
  const htmlBody = rawHtml ? sanitizeEmailHtml(rawHtml, rawId, email, allAttachments) : undefined;
  const visibleAttachments = allAttachments.filter(a => a.filename && (!a.contentId || !rawHtml.includes(`cid:${a.contentId}`)));

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
    htmlBody,
    attachments: visibleAttachments,
    snippet: msg.snippet || '',
  };
}

export async function fetchEmailAttachment(
  rawMessageId: string,
  attachmentId: string,
  accountEmail?: string
): Promise<Buffer> {
  const { cleanId, inferredAccount } = stripAccountPrefix(rawMessageId);
  const { accessToken } = await getAccessTokenForAccount(accountEmail || inferredAccount);

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(cleanId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const data = await res.json();
  if (data.error || !data.data) {
    throw new Error(`Gmail attachment error: ${data.error?.message || 'Empty attachment'}`);
  }

  const normalized = String(data.data).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
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

  const query = encodeURIComponent('in:inbox category:primary is:unread -subject:"Life OS •" -subject:"Executive Daily Briefing"');
  const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });

  const listData = await listRes.json();
  if (listData.error) {
    throw new Error(`Gmail API error (${account.email}): ${listData.error.message}`);
  }
  const messages = listData.messages || [];

  const decodeEntities = (s: string) =>
    s
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
      .replace(/&ldquo;|&rdquo;/gi, '"')
      .replace(/&mdash;/gi, '—')
      .replace(/&ndash;/gi, '–')
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  const results = await Promise.allSettled(
    messages.map(async (item: any): Promise<EmailThread | null> => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8000),
        }
      );

      if (!msgRes.ok) return null;

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

      return {
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
      };
    })
  );

  const threads: EmailThread[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      threads.push(r.value);
    }
  }
  return threads;
}

export interface FailedGmailAccount {
  email: string;
  error: string;
}

export interface FetchEmailsWithStatusResult {
  threads: EmailThread[];
  failedAccounts: FailedGmailAccount[];
  totalAccounts: number;
}

export async function fetchRecentEmailsWithStatus(maxResults = 10): Promise<FetchEmailsWithStatusResult> {
  const accounts = await getConnectedGoogleAccounts();
  if (accounts.length === 0) {
    throw new Error('No Google accounts connected');
  }

  const perAccountLimit = maxResults;
  const results = await Promise.allSettled(
    accounts.map(acc => fetchEmailsForAccount(acc, perAccountLimit))
  );

  const allThreads: EmailThread[] = [];
  const failedAccounts: FailedGmailAccount[] = [];

  results.forEach((res, idx) => {
    const acc = accounts[idx];
    if (res.status === 'fulfilled') {
      allThreads.push(...res.value);
    } else {
      failedAccounts.push({
        email: acc.email,
        error: res.reason?.message || 'Failed to fetch account',
      });
    }
  });

  const threads = allThreads
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
    .slice(0, Math.max(maxResults, 15));

  return { threads, failedAccounts, totalAccounts: accounts.length };
}

export async function fetchRecentEmails(maxResults = 10): Promise<EmailThread[]> {
  try {
    const { threads, failedAccounts, totalAccounts } = await fetchRecentEmailsWithStatus(maxResults);
    if (threads.length === 0 && failedAccounts.length === totalAccounts) {
      throw new Error(failedAccounts.map(f => `${f.email}: ${f.error}`).join('; '));
    }
    return threads;
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
  const accounts = await getConnectedGoogleAccounts();
  const normalizedRecipient = recipientEmail.trim().toLowerCase();
  const orderedAccounts = [
    ...accounts.filter(a => a.email.toLowerCase() === normalizedRecipient),
    ...accounts.filter(a => a.email.toLowerCase() !== normalizedRecipient),
  ];

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

  const candidates: Array<string | undefined> =
    orderedAccounts.length > 0 ? orderedAccounts.map(a => a.refreshToken) : [undefined];

  let lastError: Error | null = null;
  for (const refreshToken of candidates) {
    try {
      const accessToken = await getFreshAccessToken(refreshToken);
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
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error('Failed to send briefing email from all connected Google accounts');
}
