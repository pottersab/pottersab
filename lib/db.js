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

let usersInitialized = false;

// Tabel akun admin (multi-admin: Potter, Darto, Jarot, dst). Diisi lewat
// scripts/seed-admin.js, bukan lewat API publik -- tidak ada endpoint
// "register" supaya tidak ada yang bisa bikin akun admin sendiri dari luar.
async function ensureUsersTable() {
  if (usersInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_initial TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  usersInitialized = true;
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

    CREATE TABLE IF NOT EXISTS manggar_level_curahhujan (
      tanggal DATE PRIMARY KEY,
      level_waduk_manggar_m NUMERIC,
      curah_hujan_mm NUMERIC
    );

    CREATE TABLE IF NOT EXISTS kualitas_air_manggar_teritip (
      tanggal DATE PRIMARY KEY,
      ntu_manggar NUMERIC,
      ph_manggar NUMERIC,
      ntu_teritip NUMERIC,
      ph_teritip NUMERIC
    );

    CREATE TABLE IF NOT EXISTS teritip_level (
      tanggal DATE PRIMARY KEY,
      level_waduk_teritip_m NUMERIC
    );

    -- Daftar sumur aktif per instalasi. Ternormalisasi (bukan kolom tetap)
    -- karena admin bisa tambah/hapus sumur kapan saja lewat
    -- apps/input-data-historis.html tanpa perlu ALTER TABLE.
    -- category ('debit'/'level') dipisah karena data historis asli memakai
    -- penomoran sumur yang tidak selalu sama persis antara file debit dan
    -- level (mis. "Sumur_01" di debit vs "Sumur_1" di level) untuk instalasi
    -- yang sama -- dipisah per kategori supaya tidak memaksakan penyamaan
    -- yang belum tentu benar.
    CREATE TABLE IF NOT EXISTS sumur_wells (
      installation TEXT NOT NULL,
      category TEXT NOT NULL,
      well_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (installation, category, well_name)
    );

    CREATE TABLE IF NOT EXISTS sumur_debit_readings (
      installation TEXT NOT NULL,
      well_name TEXT NOT NULL,
      bulan DATE NOT NULL,
      value NUMERIC,
      PRIMARY KEY (installation, well_name, bulan)
    );

    CREATE TABLE IF NOT EXISTS sumur_level_readings (
      installation TEXT NOT NULL,
      well_name TEXT NOT NULL,
      bulan DATE NOT NULL,
      statis NUMERIC,
      dinamis NUMERIC,
      PRIMARY KEY (installation, well_name, bulan)
    );

    -- Log aktivitas viewer yang SUDAH di-approve (lihat data asli / unduh
    -- PDF), supaya admin tahu siapa buka/unduh data apa dan kapan. Tidak ada
    -- FK ke access_requests (konsisten dengan gaya tabel lain di project ini
    -- yang tidak pakai FK, mis. history) -- request_id dicocokkan manual saat
    -- query. Tidak pernah diisi untuk akses admin (JWT admin), cuma viewer
    -- yang pakai token viz-access hasil approve email.
    CREATE TABLE IF NOT EXISTS access_logs (
      id BIGSERIAL PRIMARY KEY,
      request_id BIGINT NOT NULL,
      data_type TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_access_logs_request_id ON access_logs(request_id);
  `);
  vizInitialized = true;
}

let signersInitialized = false;

// Data Nama 2 (penandatangan) -> Jabatan & Tindak Lanjut baku untuk
// apps/berita-acara.html. Dikelola admin lewat panel CRUD di halaman itu
// sendiri (bukan lewat script terpisah) supaya bisa ditambah/diedit tanpa
// deploy ulang.
async function ensureSignersTable() {
  if (signersInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS berita_acara_signers (
      nama TEXT PRIMARY KEY,
      jabatan TEXT,
      tindak_lanjut TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  signersInitialized = true;
}

let pekerjaanInitialized = false;

// Tabel kanonik seluruh pekerjaan Sub Divisi Sumber Air Baku (apps/
// riwayat-pekerjaan). Menggantikan rekap manual di Word/Google Sheet.
//
// Catatan rancangan:
// - no_ba sengaja TIDAK unique: satu berita acara bisa mencakup beberapa
//   titik pekerjaan sekaligus (di data historis ada 33 kasus, sampai 7 baris
//   dalam satu nomor).
// - lokasi_teks dipakai data historis (nama titik apa adanya, tidak pernah
//   diseragamkan). Pekerjaan baru dari Formulir SAB tidak mengisi ini --
//   lokasinya cuma koordinat GPS, ditampilkan sebagai tautan Google Maps.
// - diameter dipisah nilai + satuan karena pipa transmisi memakai mm
//   sedangkan pipa sumur memakai inch.
// - instalasi menyimpan nama baku (10 nama tanpa prefiks "IPA n"), sedangkan
//   instalasi_asli menyimpan tulisan asli dari rekap lama supaya penyeragaman
//   saat impor tetap bisa ditelusuri.
// - keterangan cuma terisi untuk data historis bidang "lainnya"; tidak ada
//   input barunya di formulir mana pun.
// - deleted_at: soft delete. Semua admin punya hak yang sama (tidak ada role
//   terpisah), jadi rekap 12 tahun ini tidak boleh bisa hilang karena salah
//   klik.
async function ensurePekerjaanTable() {
  if (pekerjaanInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pekerjaan (
      id BIGSERIAL PRIMARY KEY,
      tanggal DATE NOT NULL,
      no_ba TEXT,

      bidang TEXT NOT NULL,
      jenis TEXT,
      instalasi TEXT,
      instalasi_asli TEXT,

      lokasi_teks TEXT,
      gps_lat NUMERIC,
      gps_lng NUMERIC,
      gps_akurasi NUMERIC,

      material TEXT,
      diameter_nilai NUMERIC,
      diameter_satuan TEXT,

      uraian TEXT,
      keterangan TEXT,
      kontraktor TEXT,
      jam_mulai TIME,
      jam_selesai TIME,
      barang_pengadaan TEXT,
      barang_gudang TEXT,
      foto_urls TEXT[] NOT NULL DEFAULT '{}',

      status TEXT NOT NULL DEFAULT 'draft',
      sumber TEXT NOT NULL,
      history_id BIGINT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_pekerjaan_tanggal ON pekerjaan(tanggal);
    CREATE INDEX IF NOT EXISTS idx_pekerjaan_bidang ON pekerjaan(bidang);
    CREATE INDEX IF NOT EXISTS idx_pekerjaan_status ON pekerjaan(status);
    CREATE INDEX IF NOT EXISTS idx_pekerjaan_no_ba ON pekerjaan(no_ba);
  `);
  pekerjaanInitialized = true;
}

module.exports = { pool, ensureTable, ensureUsersTable, ensureVizTables, ensureSignersTable, ensurePekerjaanTable };
