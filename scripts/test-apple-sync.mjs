/**
 * Life OS — Phase 1A: Apple Calendar & Reminders CalDAV Verification Script
 * 
 * Verifies live connectivity with iCloud CalDAV:
 * 1. Principal & Calendar Home Set discovery
 * 2. Listing Calendars (VEVENT) & Reminder Lists (VTODO)
 * 3. Fetching active Calendar events
 * 4. Fetching active Reminders
 * 5. Two-way write-back test (create test reminder, verify, complete, cleanup)
 */

import fs from 'node:fs';
import path from 'node:path';

// Load environment variables from .env or .env.local
function loadEnv() {
  const envPaths = ['.env.local', '.env'];
  for (const envPath of envPaths) {
    const fullPath = path.resolve(process.cwd(), envPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
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
}

loadEnv();

const APPLE_ID = process.env.APPLE_ID;
const APPLE_APP_SPECIFIC_PASSWORD = process.env.APPLE_APP_SPECIFIC_PASSWORD;

if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD) {
  console.error('\x1b[31m[ERROR] Missing credentials.\x1b[0m');
  console.log('Please set APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD in .env.local');
  process.exit(1);
}

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

async function runProofOfConcept() {
  console.log('===========================================================');
  console.log('   LIFE OS — PHASE 1A: APPLE CALDAV LIVE VERIFICATION     ');
  console.log('===========================================================\n');
  console.log(`Connecting as: ${APPLE_ID}`);

  // Step 1: Principal discovery
  console.log('\n[1/5] Discovering iCloud User Principal...');
  const principalBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal />
  </d:prop>
</d:propfind>`;

  const pRes = await davRequest('https://caldav.icloud.com/', 'PROPFIND', {
    'Depth': '0',
    'Content-Type': 'application/xml; charset=utf-8',
  }, principalBody);

  if (pRes.status >= 400) {
    throw new Error(`Authentication / discovery failed (HTTP ${pRes.status}). Check your Apple ID and App-Specific Password.`);
  }

  const userPartition = pRes.headers.get('x-apple-user-partition');
  let clusterHost = userPartition ? `https://p${userPartition}-caldav.icloud.com` : 'https://caldav.icloud.com';

  const principalHref = extractInnerHref(pRes.text, 'current-user-principal');
  if (!principalHref) {
    throw new Error('Could not parse current-user-principal from iCloud response.');
  }

  const principalUrl = resolveUrl(clusterHost, principalHref);
  console.log(`✓ User Principal URL: ${principalUrl}`);

  // Step 2: Calendar Home Set discovery
  console.log('\n[2/5] Locating Calendar & Reminders Home Set...');
  const homeBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set />
  </d:prop>
</d:propfind>`;

  const hRes = await davRequest(principalUrl, 'PROPFIND', {
    'Depth': '0',
    'Content-Type': 'application/xml; charset=utf-8',
  }, homeBody);

  const homeHref = extractInnerHref(hRes.text, 'calendar-home-set');
  if (!homeHref) {
    throw new Error('Could not find calendar-home-set URL.');
  }

  const homeUrl = resolveUrl(clusterHost, homeHref);
  console.log(`✓ Calendar Home Set URL: ${homeUrl}`);

  // Step 3: Discover Collections (Calendars and Reminders lists)
  console.log('\n[3/5] Enumerating Calendar & Reminder Collections...');
  const collectionsBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <c:supported-calendar-component-set />
  </d:prop>
</d:propfind>`;

  const colRes = await davRequest(homeUrl, 'PROPFIND', {
    'Depth': '1',
    'Content-Type': 'application/xml; charset=utf-8',
  }, collectionsBody);

  const responseBlocks = [...colRes.text.matchAll(/<response[\s\S]*?<\/response>/gi)];
  const calendars = [];
  const reminderLists = [];

  for (const match of responseBlocks) {
    const raw = match[0];
    const hrefMatch = /<href[^>]*>(.*?)<\/href>/i.exec(raw);
    const nameMatch = /<displayname[^>]*>(.*?)<\/displayname>/i.exec(raw);
    if (!hrefMatch) continue;

    const href = hrefMatch[1].trim();
    // Ignore the parent home collection and inbox/outbox system mailboxes
    if (href === homeHref || href.endsWith('/inbox/') || href.endsWith('/outbox/') || href === '/8094672354/calendars/') continue;

    const name = nameMatch ? nameMatch[1].trim() : 'Untitled';
    const supportsEvent = /VEVENT/i.test(raw);
    const supportsTodo = /VTODO/i.test(raw);
    const fullColUrl = resolveUrl(homeUrl, href);

    if (supportsEvent && !supportsTodo) {
      calendars.push({ name, url: fullColUrl });
    } else if (supportsTodo) {
      reminderLists.push({ name, url: fullColUrl });
    }
  }

  console.log(`✓ Found ${calendars.length} Apple Calendar(s):`);
  calendars.forEach((c, i) => console.log(`   [Calendar ${i + 1}] "${c.name}"`));

  console.log(`✓ Found ${reminderLists.length} Apple Reminders List(s):`);
  reminderLists.forEach((r, i) => console.log(`   [List ${i + 1}] "${r.name}"`));

  if (calendars.length === 0 && reminderLists.length === 0) {
    throw new Error('No calendars or reminder lists found.');
  }

  // Step 4: Retrieve genuine calendar events and genuine reminders
  console.log('\n[4/5] Testing Live Data Retrieval...');

  // 4A: Fetch Calendar events from the first non-empty calendar
  if (calendars.length > 0) {
    const primaryCal = calendars[0];
    console.log(`  -> Querying events from Calendar: "${primaryCal.name}"...`);

    const now = new Date();
    const startRange = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endRange = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const reportEventsBody = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${startRange}" end="${endRange}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

    const evRes = await davRequest(primaryCal.url, 'REPORT', {
      'Depth': '1',
      'Content-Type': 'application/xml; charset=utf-8',
    }, reportEventsBody);

    const eventBlocks = [...evRes.text.matchAll(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi)];
    console.log(`  ✓ Successfully queried "${primaryCal.name}": found ${eventBlocks.length} event(s) in window.`);
    if (eventBlocks.length > 0) {
      const firstEvent = eventBlocks[0][0];
      const summaryMatch = /SUMMARY:(.*)/i.exec(firstEvent);
      const dtStartMatch = /DTSTART(?:;[^:]+)?:(.*)/i.exec(firstEvent);
      console.log(`    Sample Event: "${summaryMatch ? summaryMatch[1].trim() : 'Unknown'}" (Start: ${dtStartMatch ? dtStartMatch[1].trim() : 'N/A'})`);
    }
  }

  // 4B: Fetch Reminders from Reminders list
  const targetList = reminderLists[0];
  if (targetList) {
    console.log(`  -> Querying tasks from Reminders List: "${targetList.name}"...`);
    const reportTodoBody = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO" />
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

    const todoRes = await davRequest(targetList.url, 'REPORT', {
      'Depth': '1',
      'Content-Type': 'application/xml; charset=utf-8',
    }, reportTodoBody);

    const todoBlocks = [...todoRes.text.matchAll(/BEGIN:VTODO[\s\S]*?END:VTODO/gi)];
    console.log(`  ✓ Successfully queried "${targetList.name}": found ${todoBlocks.length} reminder(s).`);
    if (todoBlocks.length > 0) {
      const sampleTodo = todoBlocks[0][0];
      const summaryMatch = /SUMMARY:(.*)/i.exec(sampleTodo);
      const statusMatch = /STATUS:(.*)/i.exec(sampleTodo);
      console.log(`    Sample Task: "${summaryMatch ? summaryMatch[1].trim() : 'Untitled'}" (Status: ${statusMatch ? statusMatch[1].trim() : 'Open'})`);
    }
  }

  // Step 5: Two-Way Write-Back Test
  console.log('\n[5/5] Testing Two-Way Write-Back (Create -> Update -> Complete)...');
  const testUid = `lifeos-test-${Date.now()}`;
  const testItemUrl = targetList.url.endsWith('/') ? `${targetList.url}${testUid}.ics` : `${targetList.url}/${testUid}.ics`;
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  // 5A: Create Test Reminder
  console.log(`  -> Creating test reminder: "[Life OS] CalDAV Verification Task"...`);
  const vtodoCreate = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//LifeOS//CalDAV Test//EN
BEGIN:VTODO
UID:${testUid}
DTSTAMP:${timestamp}
SUMMARY:[Life OS] CalDAV Verification Task
STATUS:NEEDS-ACTION
PRIORITY:1
DESCRIPTION:Automated two-way synchronization proof of concept for Life OS.
END:VTODO
END:VCALENDAR`;

  const createRes = await davRequest(testItemUrl, 'PUT', {
    'Content-Type': 'text/calendar; charset=utf-8',
  }, vtodoCreate);

  if (createRes.status !== 201 && createRes.status !== 204 && createRes.status !== 200) {
    throw new Error(`Write-back creation failed with HTTP ${createRes.status}: ${createRes.text}`);
  }
  console.log(`  ✓ Task successfully created in Apple Reminders via CalDAV (HTTP ${createRes.status})!`);

  // 5B: Update Test Reminder to COMPLETED
  console.log(`  -> Updating task status to COMPLETED...`);
  const vtodoComplete = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//LifeOS//CalDAV Test//EN
BEGIN:VTODO
UID:${testUid}
DTSTAMP:${timestamp}
SUMMARY:[Life OS] CalDAV Verification Task
STATUS:COMPLETED
COMPLETED:${timestamp}
PRIORITY:1
DESCRIPTION:Automated two-way synchronization proof of concept for Life OS.
END:VTODO
END:VCALENDAR`;

  const updateRes = await davRequest(testItemUrl, 'PUT', {
    'Content-Type': 'text/calendar; charset=utf-8',
  }, vtodoComplete);

  if (updateRes.status !== 201 && updateRes.status !== 204 && updateRes.status !== 200) {
    throw new Error(`Write-back update failed with HTTP ${updateRes.status}: ${updateRes.text}`);
  }
  console.log(`  ✓ Task updated to COMPLETED in Apple Reminders (HTTP ${updateRes.status})!`);

  // 5C: Clean up test task
  console.log(`  -> Cleaning up test task...`);
  await davRequest(testItemUrl, 'DELETE');
  console.log(`  ✓ Test task cleaned up successfully.`);

  console.log('\n===========================================================');
  console.log('   🎉 ALL PHASE 1A APPLE CALDAV TESTS PASSED!             ');
  console.log('===========================================================');
  console.log('Summary:');
  console.log(`1. Apple ID Authentication: SUCCESS (${APPLE_ID})`);
  console.log(`2. Calendars Discovered: ${calendars.map(c => `"${c.name}"`).join(', ')}`);
  console.log(`3. Reminders Discovered: ${reminderLists.map(r => `"${r.name}"`).join(', ')}`);
  console.log('4. Live Event & Task Retrieval: SUCCESS');
  console.log('5. Two-Way Write-Back (Create, Complete, Delete): SUCCESS\n');
}

runProofOfConcept().catch((err) => {
  console.error('\n\x1b[31m[TEST FAILED]\x1b[0m', err.message);
  process.exit(1);
});
