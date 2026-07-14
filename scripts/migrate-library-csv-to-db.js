// Migrasi satu kali: baca apps/library/data/*.csv dan upsert ke Postgres
// (manggar_level_curahhujan, kualitas_air_manggar_teritip, teritip_level,
// sumur_wells, sumur_debit_readings, sumur_level_readings). Dibuat manual
// (bukan jalan otomatis) supaya bisa dicek dulu sebelum CSV asli dihapus.
//
// Cara pakai (dari root project ini):
//   DATABASE_URL="postgres://...." node scripts/migrate-library-csv-to-db.js
//
// Di PowerShell:
//   $env:DATABASE_URL="postgres://...."; node scripts/migrate-library-csv-to-db.js
//
// Aman dijalankan berkali-kali (semua upsert pakai ON CONFLICT DO UPDATE).

const fs = require('fs');
const path = require('path');
const { pool, ensureVizTables } = require('../lib/db');
const { SUMUR_INSTALLATIONS } = require('../lib/visualization/columns');

const DATA_DIR = path.join(__dirname, '..', 'apps', 'library', 'data');

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

function readCsv(filename) {
  return parseCSV(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
}

// --- 1. Waduk Manggar: level + curah hujan (harian) ------------------------
async function migrateManggarLevelHujan() {
  const rows = readCsv('manggar_level_curahhujan.csv');
  let count = 0;
  for (const row of rows) {
    if (!row.Tanggal) continue;
    await pool.query(
      `INSERT INTO manggar_level_curahhujan (tanggal, level_waduk_manggar_m, curah_hujan_mm)
       VALUES ($1, $2, $3)
       ON CONFLICT (tanggal) DO UPDATE SET
         level_waduk_manggar_m = EXCLUDED.level_waduk_manggar_m,
         curah_hujan_mm = EXCLUDED.curah_hujan_mm`,
      [row.Tanggal, toNumOrNull(row.Level_Waduk_Manggar_m), toNumOrNull(row.Curah_Hujan_mm)]
    );
    count++;
  }
  console.log(`[manggar_level_curahhujan] ${count} baris dimigrasi.`);
}

// --- 2. Kualitas air Manggar + Teritip (NTU/PH, harian, 1 tabel bersama) --
async function migrateKualitasAir() {
  const rows = readCsv('kualitas_air_manggar_teritip.csv');
  let count = 0;
  for (const row of rows) {
    if (!row.Tanggal) continue;
    await pool.query(
      `INSERT INTO kualitas_air_manggar_teritip (tanggal, ntu_manggar, ph_manggar, ntu_teritip, ph_teritip)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tanggal) DO UPDATE SET
         ntu_manggar = EXCLUDED.ntu_manggar,
         ph_manggar = EXCLUDED.ph_manggar,
         ntu_teritip = EXCLUDED.ntu_teritip,
         ph_teritip = EXCLUDED.ph_teritip`,
      [row.Tanggal, toNumOrNull(row.NTU_Manggar), toNumOrNull(row.PH_Manggar), toNumOrNull(row.NTU_Teritip), toNumOrNull(row.PH_Teritip)]
    );
    count++;
  }
  console.log(`[kualitas_air_manggar_teritip] ${count} baris dimigrasi.`);
}

// --- 3. Waduk Teritip: level (harian) --------------------------------------
async function migrateTeritipLevel() {
  const rows = readCsv('teritip_level.csv');
  let count = 0;
  for (const row of rows) {
    if (!row.Tanggal) continue;
    await pool.query(
      `INSERT INTO teritip_level (tanggal, level_waduk_teritip_m)
       VALUES ($1, $2)
       ON CONFLICT (tanggal) DO UPDATE SET level_waduk_teritip_m = EXCLUDED.level_waduk_teritip_m`,
      [row.Tanggal, toNumOrNull(row.Level_Waduk_Teritip_m)]
    );
    count++;
  }
  console.log(`[teritip_level] ${count} baris dimigrasi.`);
}

// --- 4. Sumur Dalam: Debit (bulanan, kolom dinamis per sumur) --------------
async function migrateSumurDebit(installation, filename) {
  const rows = readCsv(filename);
  if (rows.length === 0) { console.log(`[sumur_debit_readings/${installation}] file kosong, dilewati.`); return; }
  const wellColumns = Object.keys(rows[0]).filter(h => h !== 'Bulan');

  for (let i = 0; i < wellColumns.length; i++) {
    await pool.query(
      `INSERT INTO sumur_wells (installation, category, well_name, sort_order)
       VALUES ($1, 'debit', $2, $3)
       ON CONFLICT (installation, category, well_name) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
      [installation, wellColumns[i], i]
    );
  }

  let count = 0;
  for (const row of rows) {
    if (!row.Bulan) continue;
    const bulanDate = `${row.Bulan}-01`;
    for (const well of wellColumns) {
      const value = toNumOrNull(row[well]);
      if (value === null) continue; // sel kosong di CSV -> tidak perlu baris (default null kalau ditanya nanti)
      await pool.query(
        `INSERT INTO sumur_debit_readings (installation, well_name, bulan, value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (installation, well_name, bulan) DO UPDATE SET value = EXCLUDED.value`,
        [installation, well, bulanDate, value]
      );
      count++;
    }
  }
  console.log(`[sumur_debit_readings/${installation}] ${wellColumns.length} sumur, ${count} nilai dimigrasi.`);
}

// --- 5. Sumur Dalam: Statis/Dinamis (bulanan, kolom "<Sumur>_Statis"/"_Dinamis") --
async function migrateSumurLevel(installation, filename) {
  const rows = readCsv(filename);
  if (rows.length === 0) { console.log(`[sumur_level_readings/${installation}] file kosong, dilewati.`); return; }

  const header = Object.keys(rows[0]);
  const wellSet = [];
  header.forEach(h => {
    if (h === 'Bulan') return;
    const m = h.match(/^(.*)_(Statis|Dinamis)$/i);
    if (m && !wellSet.includes(m[1])) wellSet.push(m[1]);
  });

  for (let i = 0; i < wellSet.length; i++) {
    await pool.query(
      `INSERT INTO sumur_wells (installation, category, well_name, sort_order)
       VALUES ($1, 'level', $2, $3)
       ON CONFLICT (installation, category, well_name) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
      [installation, wellSet[i], i]
    );
  }

  let count = 0;
  for (const row of rows) {
    if (!row.Bulan) continue;
    const bulanDate = `${row.Bulan}-01`;
    for (const well of wellSet) {
      const statis = toNumOrNull(row[well + '_Statis']);
      const dinamis = toNumOrNull(row[well + '_Dinamis']);
      if (statis === null && dinamis === null) continue;
      await pool.query(
        `INSERT INTO sumur_level_readings (installation, well_name, bulan, statis, dinamis)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (installation, well_name, bulan) DO UPDATE SET statis = EXCLUDED.statis, dinamis = EXCLUDED.dinamis`,
        [installation, well, bulanDate, statis, dinamis]
      );
      count++;
    }
  }
  console.log(`[sumur_level_readings/${installation}] ${wellSet.length} sumur, ${count} nilai dimigrasi.`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL belum diset. Contoh: DATABASE_URL="postgres://..." node scripts/migrate-library-csv-to-db.js');
    process.exit(1);
  }

  await ensureVizTables();

  await migrateManggarLevelHujan();
  await migrateKualitasAir();
  await migrateTeritipLevel();

  for (const inst of SUMUR_INSTALLATIONS) {
    await migrateSumurDebit(inst.installation, `${inst.debitKey}.csv`);
    await migrateSumurLevel(inst.installation, `${inst.levelKey}.csv`);
  }

  console.log('Migrasi Library selesai. Bandingkan jumlah baris di atas dengan jumlah baris CSV asli sebelum menghapus file CSV.');
  await pool.end();
}

main().catch(err => {
  console.error('Migrasi gagal:', err);
  process.exit(1);
});
