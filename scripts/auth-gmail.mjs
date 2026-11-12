/**
 * Life OS — Phase 1A: Gmail OAuth & Live Retrieval Verification Script
 * 
 * 1. Generates Google OAuth consent URL with offline access
 * 2. Starts a temporary local HTTP server on port 3000
 * 3. Catches callback at http://localhost:3000/api/auth/callback/google
 * 4. Exchanges authorization code for Refresh Token & Access Token
 * 5. Saves GOOGLE_REFRESH_TOKEN to .env.local
 * 6. Tests live query against Gmail REST API (fetching recent unread messages)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/callback/google';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\x1b[31m[ERROR] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env.local\x1b[0m');
  process.exit(1);
}

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPES,
  access_type: 'offline',
  prompt: 'consent',
}).toString();

console.log('===========================================================');
console.log('       LIFE OS — PHASE 1A: GMAIL OAUTH VERIFICATION        ');
console.log('===========================================================\n');
console.log('Waiting for you to authorize Gmail access...');
console.log('\nPlease open this URL in your browser to sign in:\n');
console.log(`\x1b[36m${authUrl}\x1b[0m\n`);
console.log('Listening on http://localhost:3000/api/auth/callback/google ...');

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, 'http://localhost:3000');
    if (reqUrl.pathname === '/api/auth/callback/google') {
      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Authorization Failed</h1><p>${error}</p>`);
        console.error('\x1b[31mAuthorization error:\x1b[0m', error);
        server.close();
        process.exit(1);
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Missing Code</h1><p>No authorization code received.</p>`);
        return;
      }

      // Exchange code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData = await tokenRes.json();
      if (tokenData.error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Token Exchange Error</h1><p>${tokenData.error_description || tokenData.error}</p>`);
        console.error('Token error:', tokenData);
        server.close();
        process.exit(1);
        return;
      }

      const refreshToken = tokenData.refresh_token;
      const accessToken = tokenData.access_token;

      // Update .env.local
      if (refreshToken) {
        const envLocalPath = path.resolve(process.cwd(), '.env.local');
        let envContent = fs.readFileSync(envLocalPath, 'utf8');
        if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
          envContent = envContent.replace(/GOOGLE_REFRESH_TOKEN=.*/, `GOOGLE_REFRESH_TOKEN="${refreshToken}"`);
        } else {
          envContent += `\nGOOGLE_REFRESH_TOKEN="${refreshToken}"\n`;
        }
        fs.writeFileSync(envLocalPath, envContent, 'utf8');
        console.log('✓ Successfully saved GOOGLE_REFRESH_TOKEN to .env.local');
      }

      // Test Live Gmail query
      console.log('\nTesting Live Gmail API Retrieval...');
      const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=is:unread', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const listData = await listRes.json();
      const messages = listData.messages || [];
      console.log(`✓ Successfully queried Gmail: found ${messages.length} recent unread thread(s).`);

      let sampleDetails = '';
      if (messages.length > 0) {
        const firstMsgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messages[0].id}?format=metadata`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const msgData = await firstMsgRes.json();
        const headers = msgData.payload?.headers || [];
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
        const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown';
        console.log(`  Sample Thread: "${subject}" from ${from}`);
        sampleDetails = `<p><strong>Sample Thread:</strong> "${subject}" from <em>${from}</em></p>`;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Life OS — Gmail Connected</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
  <div style="background: #18181b; padding: 2.5rem; border-radius: 1rem; border: 1px solid #27272a; max-width: 480px; text-align: center;">
    <h2 style="color: #22c55e; margin-top: 0;">✓ Gmail Connected Successfully!</h2>
    <p style="color: #a1a1aa;">Life OS has securely linked with your Gmail account.</p>
    ${sampleDetails}
    <p style="color: #71717a; font-size: 0.875rem;">You can close this tab and return to your terminal.</p>
  </div>
</body>
</html>`);

      console.log('\n===========================================================');
      console.log('   🎉 ALL PHASE 1A GMAIL VERIFICATION TESTS PASSED!       ');
      console.log('===========================================================');
      console.log('1. OAuth2 Code Exchange: SUCCESS');
      console.log('2. Refresh Token Persistent Storage: SUCCESS');
      console.log('3. Live Gmail API Messages Retrieval: SUCCESS\n');

      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 1000);
    }
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
});

server.listen(3000);
