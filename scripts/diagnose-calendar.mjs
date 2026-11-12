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

const APPLE_ID = process.env.APPLE_ID;
const APPLE_APP_SPECIFIC_PASSWORD = process.env.APPLE_APP_SPECIFIC_PASSWORD;

const authHeader = 'Basic ' + Buffer.from(`${APPLE_ID}:${APPLE_APP_SPECIFIC_PASSWORD.trim()}`).toString('base64');

async function davRequest(url, method, headers = {}, body = null) {
  const defaultHeaders = {
    'Authorization': authHeader,
    'User-Agent': 'LifeOS-CalDAV-Client/1.0',
    ...headers,
  };

  const res = await fetch(url, {
    method,
    headers: defaultHeaders,
    body: body || undefined,
    redirect: 'follow',
  });

  const text = await res.text();
  return { status: res.status, url: res.url, headers: res.headers, text };
}

function extractInnerHref(xml, containerTag) {
  const containerRegex = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${containerTag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${containerTag}>`, 'i');
  const containerMatch = containerRegex.exec(xml);
  if (!containerMatch) return null;
  const hrefMatch = /<(?:[a-zA-Z0-9_-]+:)?href[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?href>/i.exec(containerMatch[1]);
  return hrefMatch ? hrefMatch[1].trim() : null;
}

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

async function diagnose() {
  console.log('Connecting to iCloud CalDAV...');
  const pRes = await davRequest('https://caldav.icloud.com/', 'PROPFIND', {
    'Depth': '0',
    'Content-Type': 'application/xml; charset=utf-8',
  }, `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal /></d:prop></d:propfind>`);

  const userPartition = pRes.headers.get('x-apple-user-partition');
  const clusterHost = userPartition ? `https://p${userPartition}-caldav.icloud.com` : 'https://caldav.icloud.com';
  const principalHref = extractInnerHref(pRes.text, 'current-user-principal');
  const principalUrl = resolveUrl(clusterHost, principalHref);

  const hRes = await davRequest(principalUrl, 'PROPFIND', {
    'Depth': '0',
    'Content-Type': 'application/xml; charset=utf-8',
  }, `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set /></d:prop></d:propfind>`);

  const homeHref = extractInnerHref(hRes.text, 'calendar-home-set');
  const homeUrl = resolveUrl(clusterHost, homeHref);

  const colRes = await davRequest(homeUrl, 'PROPFIND', {
    'Depth': '1',
    'Content-Type': 'application/xml; charset=utf-8',
  }, `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname /><d:resourcetype /><c:supported-calendar-component-set /></d:prop></d:propfind>`);

  const responseBlocks = [...colRes.text.matchAll(/<response[\s\S]*?<\/response>/gi)];

  console.log(`Discovered ${responseBlocks.length} collection responses.`);

  for (const match of responseBlocks) {
    const raw = match[0];
    const hrefMatch = /<href[^>]*>(.*?)<\/href>/i.exec(raw);
    const nameMatch = /<displayname[^>]*>(.*?)<\/displayname>/i.exec(raw);
    if (!hrefMatch) continue;

    const href = hrefMatch[1].trim();
    if (href === homeHref || href.endsWith('/inbox/') || href.endsWith('/outbox/') || href === '/8094672354/calendars/') continue;

    const name = nameMatch ? nameMatch[1].trim() : 'Untitled';
    const supportsEvent = /VEVENT/i.test(raw);
    const supportsTodo = /VTODO/i.test(raw);
    const fullColUrl = resolveUrl(homeUrl, href);

    console.log(`\n========================================`);
    console.log(`Collection: "${name}" (${href})`);
    console.log(`Supports: VEVENT=${supportsEvent}, VTODO=${supportsTodo}`);
    console.log(`URL: ${fullColUrl}`);

    // Query all items without strict time filter to see what is inside
    const queryBody = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag /><c:calendar-data /></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR" />
  </c:filter>
</c:calendar-query>`;

    const qRes = await davRequest(fullColUrl, 'REPORT', {
      'Depth': '1',
      'Content-Type': 'application/xml; charset=utf-8',
    }, queryBody);

    const items = [...qRes.text.matchAll(/BEGIN:(?:VEVENT|VTODO)[\s\S]*?END:(?:VEVENT|VTODO)/gi)];
    console.log(`Items found: ${items.length}`);
    for (const item of items) {
      const it = item[0];
      const isEvent = it.startsWith('BEGIN:VEVENT');
      const sum = /SUMMARY:(.*)/i.exec(it);
      const dtStart = /DTSTART(?:;[^:]+)?:(.*)/i.exec(it);
      const due = /DUE(?:;[^:]+)?:(.*)/i.exec(it);
      console.log(`   * [${isEvent ? 'EVENT' : 'TODO'}] "${sum ? sum[1].trim() : 'Unknown'}" (Start: ${dtStart ? dtStart[1].trim() : 'N/A'}, Due: ${due ? due[1].trim() : 'N/A'})`);
    }
  }
}

diagnose().catch(console.error);
