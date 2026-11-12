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
