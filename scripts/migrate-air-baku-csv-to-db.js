// Migrasi satu kali: baca apps/riwayat-air-baku/data/*.csv dan upsert ke
// tabel Postgres (air_permukaan, air_tanah_dalam). Dibuat manual (bukan
// jalan otomatis) supaya bisa dicek dulu sebelum file CSV asli dihapus.
//
// Cara pakai (dari root project ini):
//   DATABASE_URL="postgres://...." node scripts/migrate-air-baku-csv-to-db.js
//
// Di PowerShell:
//   $env:DATABASE_URL="postgres://...."; node scripts/migrate-air-baku-csv-to-db.js
//
// Aman dijalankan berkali-kali (upsert by bulan, ON CONFLICT DO UPDATE).

const fs = require('fs');
const path = require('path');
const { pool, ensureVizTables } = require('../api/_db');
const { DATASETS } = require('../api/visualization/_columns');

function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length > 0);
  const header = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = (cells[i] !== undefined ? cells[i].trim() : ''); });
    return row;
  });
}

function toNumOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

async function migrateOne(dataTypeKey, csvPath) {
  const source = DATASETS[dataTypeKey];
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(text);

  let count = 0;
  for (const row of rows) {
    const bulan = row.Bulan;
    if (!bulan) continue;
    const bulanDate = `${bulan}-01`; // "2015-07" -> "2015-07-01"

    const dbCols = source.columns.map(c => c.db);
    const values = source.columns.map(c => toNumOrNull(row[c.csv]));

    const colList = ['bulan', ...dbCols].join(', ');
    const placeholders = ['$1', ...dbCols.map((_, i) => `$${i + 2}`)].join(', ');
    const updateSet = dbCols.map(c => `${c} = EXCLUDED.${c}`).join(', ');

    await pool.query(
      `INSERT INTO ${source.table} (${colList}) VALUES (${placeholders})
       ON CONFLICT (bulan) DO UPDATE SET ${updateSet}`,
      [bulanDate, ...values]
    );
    count++;
  }
  console.log(`[${dataTypeKey}] ${count} baris dimigrasi ke tabel ${source.table}.`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL belum diset. Contoh: DATABASE_URL="postgres://..." node scripts/migrate-air-baku-csv-to-db.js');
    process.exit(1);
  }

  await ensureVizTables();

  await migrateOne('ap', path.join(__dirname, '..', 'apps', 'riwayat-air-baku', 'data', 'air_permukaan.csv'));
  await migrateOne('atd', path.join(__dirname, '..', 'apps', 'riwayat-air-baku', 'data', 'air_tanah_dalam.csv'));

  console.log('Migrasi selesai. Cek jumlah baris di atas cocok dengan jumlah baris CSV (133 baris termasuk header di tiap file, jadi 132 baris data) sebelum menghapus file CSV.');
  await pool.end();
}

main().catch(err => {
  console.error('Migrasi gagal:', err);
  process.exit(1);
});
