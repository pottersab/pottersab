const { Pool } = require('pg');

// Vercel Postgres (via Neon Marketplace) otomatis inject DATABASE_URL.
// Jika nama env variable di dashboard Anda berbeda (misal POSTGRES_URL),
// tambahkan DATABASE_URL secara manual di Vercel dengan value yang sama.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let initialized = false;

async function ensureTable() {
  if (initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS history (
      id BIGINT PRIMARY KEY,
      document_type TEXT NOT NULL,
      document_name TEXT NOT NULL,
      details JSONB,
      created_by TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  initialized = true;
}

module.exports = { pool, ensureTable };
