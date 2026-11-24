/**
 * Life OS — Database Service (Supabase PostgreSQL)
 * Handles historical briefing storage and sync audit logging
 */

import pg from 'pg';
import { DailyBriefing } from './types';

const connectionString = process.env.DATABASE_URL;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool | null {
  if (!connectionString) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: process.env.NODE_ENV === 'production' ? 2 : 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

export async function saveBriefingToDb(briefing: DailyBriefing): Promise<void> {
  const p = getPool();
  if (!p) return;

  try {
    await p.query(
      `INSERT INTO daily_briefings (
        id, briefing_date, generated_at, headline, top_priorities,
        agenda_summary, email_highlights, warnings_or_overdue, suggested_preparation, full_markdown
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        headline = EXCLUDED.headline,
        top_priorities = EXCLUDED.top_priorities,
        agenda_summary = EXCLUDED.agenda_summary,
        email_highlights = EXCLUDED.email_highlights,
        warnings_or_overdue = EXCLUDED.warnings_or_overdue,
        suggested_preparation = EXCLUDED.suggested_preparation;`,
      [
        briefing.id,
        briefing.briefingDate,
        briefing.generatedAt,
        briefing.headline,
        JSON.stringify(briefing.topPriorities),
        briefing.agendaSummary,
        briefing.emailHighlights,
        JSON.stringify(briefing.warningsOrOverdue),
        briefing.suggestedPreparation,
        briefing.fullMarkdown || '',
      ]
    );
  } catch (err: any) {
    console.error('Failed to save briefing to Supabase:', err.message);
  }
}

export async function getLatestBriefingFromDb(): Promise<DailyBriefing | null> {
  const p = getPool();
  if (!p) return null;

  try {
    const res = await p.query(
      `SELECT * FROM daily_briefings ORDER BY generated_at DESC LIMIT 1`
    );
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
      id: row.id,
      briefingDate: row.briefing_date.toISOString().split('T')[0],
      generatedAt: row.generated_at.toISOString(),
      headline: row.headline,
      topPriorities: typeof row.top_priorities === 'string' ? JSON.parse(row.top_priorities) : row.top_priorities,
      agendaSummary: row.agenda_summary,
      emailHighlights: row.email_highlights,
      warningsOrOverdue: typeof row.warnings_or_overdue === 'string' ? JSON.parse(row.warnings_or_overdue) : row.warnings_or_overdue,
      suggestedPreparation: row.suggested_preparation,
      fullMarkdown: row.full_markdown,
      lastSyncTimestamp: row.generated_at.toISOString(),
    };
  } catch (err: any) {
    console.error('Failed to get latest briefing from Supabase:', err.message);
    return null;
  }
}

export async function logSyncHealth(service: string, status: 'SUCCESS' | 'ERROR', count = 0, message?: string) {
  const p = getPool();
  if (!p) return;

  try {
    await p.query(
      `INSERT INTO sync_audit_logs (service, status, records_count, message) VALUES ($1, $2, $3, $4)`,
      [service, status, count, message || null]
    );
  } catch (err: any) {
    console.error('Failed to log sync health to Supabase:', err.message);
  }
}

export async function logSyncAudit(service: string, success: boolean, details?: any) {
  return logSyncHealth(
    service,
    success ? 'SUCCESS' : 'ERROR',
    details?.eventsCount || 0,
    details ? JSON.stringify(details) : undefined
  );
}

export async function getAppSetting(key: string): Promise<string | null> {
  const p = getPool();
  if (!p) return null;
  try {
    const res = await p.query(`SELECT value FROM app_settings WHERE key = $1 LIMIT 1`, [key]);
    if (res.rows.length === 0) return null;
    return res.rows[0].value;
  } catch (err: any) {
    console.warn(`Could not read setting ${key} from Supabase:`, err.message);
    return null;
  }
}

export async function saveAppSetting(key: string, value: string): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );
  } catch (err: any) {
    console.error(`Could not save setting ${key} to Supabase:`, err.message);
  }
}

export async function saveSyncedReminders(reminders: any[]): Promise<void> {
  await saveAppSetting('SYNCED_REMINDERS', JSON.stringify(reminders));
}

export async function getSyncedReminders(): Promise<any[]> {
  const raw = await getAppSetting('SYNCED_REMINDERS');
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function updateSyncedReminderStatus(uid: string, isCompleted: boolean): Promise<void> {
  const existing = await getSyncedReminders();
  const updated = existing.map(r =>
    r.uid === uid || r.id === uid
      ? { ...r, isCompleted, completedAt: isCompleted ? new Date().toISOString() : undefined }
      : r
  );
  await saveSyncedReminders(updated);
}

export async function completeSyncedReminderByTitle(matchTitle: string): Promise<boolean> {
  const needle = matchTitle.trim().toLowerCase();
  if (!needle) return false;
  const existing = await getSyncedReminders();
  let matched = false;
  const updated = existing.map(r => {
    const t = String(r.title || '').trim().toLowerCase();
    if (!r.isCompleted && (t === needle || t.includes(needle) || needle.includes(t))) {
      matched = true;
      return { ...r, isCompleted: true, completedAt: new Date().toISOString() };
    }
    return r;
  });
  if (matched) {
    await saveSyncedReminders(updated);
  }
  return matched;
}

export async function getPendingReminders(): Promise<any[]> {
  const raw = await getAppSetting('PENDING_REMINDERS');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function addPendingReminder(input: {
  title: string;
  listName?: string;
  dueDate?: string;
  notes?: string;
  replaceTitle?: string;
}): Promise<any> {
  const cleanTitle = input.title.trim();
  const listName = (input.listName || 'Reminders').trim();
  const uid = `lifeos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const matchKey = (input.replaceTitle || cleanTitle).trim().toLowerCase();

  const newTask = {
    id: uid,
    uid,
    title: cleanTitle,
    listName,
    isCompleted: false,
    priority: 0 as const,
    dueDate: input.dueDate || undefined,
    notes: input.notes?.trim() || undefined,
    replaceTitle: input.replaceTitle?.trim() || undefined,
  };

  const pending = await getPendingReminders();
  const filteredPending = pending.filter(
    p => String(p.title || '').trim().toLowerCase() !== matchKey
  );
  filteredPending.push(newTask);
  await saveAppSetting('PENDING_REMINDERS', JSON.stringify(filteredPending));

  const synced = await getSyncedReminders();
  const filteredSynced = synced.filter(
    r => r.isCompleted || String(r.title || '').trim().toLowerCase() !== matchKey
  );
  filteredSynced.unshift(newTask);
  await saveSyncedReminders(filteredSynced);

  return newTask;
}

export async function clearPendingReminders(uidsToRemove: string[]): Promise<void> {
  if (!uidsToRemove || uidsToRemove.length === 0) return;
  const removeSet = new Set(uidsToRemove);
  const pending = await getPendingReminders();
  const remaining = pending.filter(p => !removeSet.has(p.uid) && !removeSet.has(p.id));
  await saveAppSetting('PENDING_REMINDERS', JSON.stringify(remaining));
}

const DEFAULT_ASSISTANT_RULES = [
  'All meetings should be scheduled under the Work calendar by default.',
];

export async function getAssistantRules(): Promise<string[]> {
  const raw = await getAppSetting('ASSISTANT_RULES');
  if (!raw) return DEFAULT_ASSISTANT_RULES;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((r: any) => typeof r === 'string' && r.trim().length > 0);
    }
  } catch {}
  return DEFAULT_ASSISTANT_RULES;
}

export async function addAssistantRule(rule: string): Promise<string[]> {
  const clean = rule.trim();
  if (!clean) return getAssistantRules();
  const rules = await getAssistantRules();
  if (!rules.some(r => r.toLowerCase() === clean.toLowerCase())) {
    rules.push(clean);
    await saveAppSetting('ASSISTANT_RULES', JSON.stringify(rules));
  }
  return rules;
}
