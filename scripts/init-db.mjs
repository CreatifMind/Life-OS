import pg from 'pg';
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

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Missing DATABASE_URL in .env.local');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Required for Supabase external SSL connections
});

async function initDb() {
  console.log('Connecting to Supabase PostgreSQL...');
  const client = await pool.connect();
  try {
    console.log('✓ Successfully connected to database!');

    console.log('Creating tables...');

    // 1. Daily Briefings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_briefings (
        id VARCHAR(64) PRIMARY KEY,
        briefing_date DATE NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        headline TEXT NOT NULL,
        top_priorities JSONB NOT NULL,
        agenda_summary TEXT,
        email_highlights TEXT,
        warnings_or_overdue JSONB,
        suggested_preparation TEXT,
        full_markdown TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_briefings_date ON daily_briefings(briefing_date DESC);
    `);
    console.log('✓ Table "daily_briefings" ready.');

    // 2. Sync Audit Logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_audit_logs (
        id SERIAL PRIMARY KEY,
        service VARCHAR(32) NOT NULL,
        status VARCHAR(16) NOT NULL,
        records_count INT DEFAULT 0,
        message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sync_logs_service ON sync_audit_logs(service, created_at DESC);
    `);
    console.log('✓ Table "sync_audit_logs" ready.');

    // 3. Action Proposals table (Email-to-Task approval queue)
    await client.query(`
      CREATE TABLE IF NOT EXISTS action_proposals (
        id VARCHAR(64) PRIMARY KEY,
        source_type VARCHAR(16) NOT NULL,
        source_id VARCHAR(128),
        proposed_title TEXT NOT NULL,
        proposed_due_date TIMESTAMPTZ,
        priority VARCHAR(16) DEFAULT 'MEDIUM',
        source_snippet TEXT,
        status VARCHAR(16) DEFAULT 'PENDING',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_proposals_status ON action_proposals(status, created_at DESC);
    `);
    console.log('✓ Table "action_proposals" ready.');

    console.log('\n🎉 Supabase PostgreSQL Schema successfully initialized!');
  } finally {
    client.release();
    await pool.end();
  }
}

initDb().catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
