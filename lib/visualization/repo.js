const { pool } = require('../db');

// --- kind: 'wide' (air baku ap/atd) ---------------------------------------
// Ambil data asli untuk satu source 'wide', bentuknya sama dengan shape lama
// (Bulan 'YYYY-MM' + kolom per instalasi bernama sesuai CSV asli).
async function fetchRealRows(source) {
  const dbCols = source.columns.map(c => c.db);
  const { rows: dbRows } = await pool.query(
    `SELECT to_char(${source.dateCol}, 'YYYY-MM') as bulan, ${dbCols.join(', ')} FROM ${source.table} ORDER BY ${source.dateCol}`
  );

  return dbRows.map(r => {
    const row = { Bulan: r.bulan };
    source.columns.forEach(c => {
      row[c.csv] = r[c.db] !== null && r[c.db] !== undefined ? Number(r[c.db]) : null;
    });
    return row;
  });
}

// --- kind: 'wide-single' (Manggar/Teritip harian) -------------------------
// Ambil SEMUA baris tabel (bukan cuma yang kolom ini terisi) supaya bentuk
// sumbu tanggal persis sama dengan file CSV asli (sel kosong = null, bukan
// baris hilang) -- tabelnya memang dipakai bersama beberapa key sekaligus
// (mis. kualitas_air_manggar_teritip dipakai 4 key: manggar/teritip x ntu/ph).
async function fetchWideSingleRows(source) {
  const dateKey = source.dateGranularity === 'day' ? 'Tanggal' : 'Bulan';
  const dateFormat = source.dateGranularity === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  const { rows: dbRows } = await pool.query(
    `SELECT to_char(${source.dateCol}, '${dateFormat}') as d, ${source.col} FROM ${source.table} ORDER BY ${source.dateCol}`
  );
  const rows = dbRows.map(r => ({
    [dateKey]: r.d,
    [source.csvCol]: r[source.col] !== null && r[source.col] !== undefined ? Number(r[source.col]) : null
  }));
  return { dateKey, rows };
}

// --- Sumur Dalam (ternormalisasi) -----------------------------------------
// category: 'debit' | 'level' -- dipisah karena penomoran sumur historis
// tidak selalu sama persis antara dataset debit & level (lihat catatan di
// lib/db.js pada definisi tabel sumur_wells).
async function fetchSumurWells(installation, category) {
  const { rows } = await pool.query(
    'SELECT well_name FROM sumur_wells WHERE installation = $1 AND category = $2 ORDER BY sort_order, well_name',
    [installation, category]
  );
  return rows.map(r => r.well_name);
}

// Pivot sumur_debit_readings (installation, well_name, bulan, value) jadi
// bentuk lebar (Bulan + 1 kolom per sumur) supaya sama seperti CSV lama.
async function fetchSumurDebitRows(source) {
  const wells = await fetchSumurWells(source.installation, 'debit');
  const { rows: readings } = await pool.query(
    `SELECT well_name, to_char(bulan, 'YYYY-MM') as bulan, value
     FROM sumur_debit_readings WHERE installation = $1 ORDER BY bulan`,
    [source.installation]
  );

  const byBulan = new Map();
  readings.forEach(r => {
    if (!byBulan.has(r.bulan)) byBulan.set(r.bulan, { Bulan: r.bulan });
    byBulan.get(r.bulan)[r.well_name] = r.value !== null && r.value !== undefined ? Number(r.value) : null;
  });
  const rows = Array.from(byBulan.values()).sort((a, b) => (a.Bulan < b.Bulan ? -1 : a.Bulan > b.Bulan ? 1 : 0));
  return { wells, rows };
}

// Sama seperti di atas, tapi 2 nilai per sumur (Statis/Dinamis), nama kolom
// hasil pivot mengikuti pola lama "<NamaSumur>_Statis" / "<NamaSumur>_Dinamis".
async function fetchSumurLevelRows(source) {
  const wells = await fetchSumurWells(source.installation, 'level');
  const { rows: readings } = await pool.query(
    `SELECT well_name, to_char(bulan, 'YYYY-MM') as bulan, statis, dinamis
     FROM sumur_level_readings WHERE installation = $1 ORDER BY bulan`,
    [source.installation]
  );

  const byBulan = new Map();
  readings.forEach(r => {
    if (!byBulan.has(r.bulan)) byBulan.set(r.bulan, { Bulan: r.bulan });
    const row = byBulan.get(r.bulan);
    row[r.well_name + '_Statis'] = r.statis !== null && r.statis !== undefined ? Number(r.statis) : null;
    row[r.well_name + '_Dinamis'] = r.dinamis !== null && r.dinamis !== undefined ? Number(r.dinamis) : null;
  });
  const rows = Array.from(byBulan.values()).sort((a, b) => (a.Bulan < b.Bulan ? -1 : a.Bulan > b.Bulan ? 1 : 0));
  return { wells, rows };
}

module.exports = { fetchRealRows, fetchWideSingleRows, fetchSumurWells, fetchSumurDebitRows, fetchSumurLevelRows };
