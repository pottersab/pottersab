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

let vizInitialized = false;

// Tabel untuk data visualisasi Air Baku (apps/riwayat-air-baku). Data asli
// dipindah kesini dari CSV statis supaya tidak bisa diakses langsung lewat
// URL file, dan hanya dikeluarkan oleh api/visualization/data.js kalau ada
// token akses (viz-access) atau JWT admin yang valid.
async function ensureVizTables() {
  if (vizInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id BIGSERIAL PRIMARY KEY,
      requested_by TEXT NOT NULL,
      data_type TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      approve_secret TEXT NOT NULL,
      token TEXT,
      token_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      approved_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS air_permukaan (
      bulan DATE PRIMARY KEY,
      teritip NUMERIC,
      kampung_damai NUMERIC,
      batu_ampar NUMERIC,
      km_12 NUMERIC,
      gunung_tembak NUMERIC
    );

    CREATE TABLE IF NOT EXISTS air_tanah_dalam (
      bulan DATE PRIMARY KEY,
      kampung_damai NUMERIC,
      gunung_sari NUMERIC,
      prapatan NUMERIC,
      zamp NUMERIC,
      kampung_baru_ulu NUMERIC
    );
  `);
  vizInitialized = true;
}

module.exports = { pool, ensureTable, ensureVizTables };
