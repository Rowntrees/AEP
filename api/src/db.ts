import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      purpose     TEXT NOT NULL,
      encrypted_key_blob TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status      TEXT NOT NULL DEFAULT 'stopped'
    );

    CREATE TABLE IF NOT EXISTS management_tokens (
      agent_id    TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          BIGSERIAL PRIMARY KEY,
      agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS runs (
      id          BIGSERIAL PRIMARY KEY,
      agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      status      TEXT NOT NULL DEFAULT 'running',
      started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at    TIMESTAMPTZ,
      summary     TEXT
    );
  `);
}
