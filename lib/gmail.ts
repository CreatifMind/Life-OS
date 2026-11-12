/**
 * Life OS — Gmail API Service
 * Handles OAuth refresh token rotation and fetches priority unread threads
 */

import { EmailThread } from './types';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || '';

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export async function getFreshAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 60000) {
    return cachedAccessToken.token;
  }

  if (!REFRESH_TOKEN || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Missing Google OAuth credentials in .env.local');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (data.error || !data.access_token) {
    throw new Error(`Failed to refresh Google access token: ${data.error_description || data.error}`);
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  return cachedAccessToken.token;
}

export async function fetchRecentEmails(maxResults = 10): Promise<EmailThread[]> {
  try {
    const accessToken = await getFreshAccessToken();

    // Query for priority unread or important messages from the last 7 days
    const query = encodeURIComponent('is:unread');
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const listData = await listRes.json();
    if (listData.error) {
      throw new Error(`Gmail API error (${listData.error.code}): ${listData.error.message}`);
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

      // Parse sender name & email
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
        id: item.id,
        threadId: item.threadId,
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
  } catch (err: any) {
    console.error('Error fetching emails from Gmail:', err.message);
    throw err;
  }
}
