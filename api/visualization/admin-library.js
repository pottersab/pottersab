const { pool, ensureVizTables, ensureSignersTable, ensureSpdTables, ensureSumberTables, ensurePetaTables, ensureTable: ensureHistoryTable } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const { DATASETS } = require('../../lib/visualization/columns');
const { fetchSumurWells } = require('../../lib/visualization/repo');
const { nomorDariId, installationDariId, nomorDariWellName, normalisasiIdSumur, pastikanSumurTerdaftar } = require('../../lib/visualization/sumur-well');
// Titik BAWAAN peta (nama + koordinat). Dipakai handlePeta waktu DELETE untuk
// membedakan "titik yang ditambahkan admin" dari "titik bawaan yang cuma
// dilepas koreksinya" -- lihat komentar di sana. Dibaca di sisi SERVER, bukan
// dipercaya dari klien: yang menentukan sumurnya boleh dihapus atau tidak tidak
// boleh bergantung pada apa yang dikirim browser.
const LOKASI_BAWAAN = require('../../apps/peta-ipa-sumur/data/lokasi.json');
// getK97PumpType sengaja TIDAK di-require di sini: kpi.js (308 KB) cuma
// dipakai untuk auto-fill saat buka form edit sumur. Kalau di-require di
// top-level, setiap cold start (fungsi serverless "tidur" di paket Hobby)
// harus mengurai modul sebesar itu padahal aksi lain -- termasuk Simpan
// sumber -- tidak pernah butuh KPI. Dimuat lazy di dalam autoFillSumur.
const { put, del } = require('@vercel/blob');

// Endpoint gabungan untuk semua input admin apps/library (dulu 3 file
// terpisah: admin-library-daily.js, admin-library-sumur.js,
// admin-library-wells.js -- digabung supaya jumlah file di api/ tidak
// melebihi batas 12 Serverless Functions di Vercel Hobby plan). Dibedakan
// lewat query param ?action=daily|sumur|wells. Logic tiap action PERSIS
// sama dengan versi file terpisahnya, cuma dipindah jadi fungsi sendiri.

function toNumOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// --- action=map-latest: nilai TERAKHIR per lokasi (IPA/Sumur/Waduk) untuk
// apps/peta-ipa-sumur -- endpoint PUBLIK (tanpa admin), sama seperti
// api/home-summary.js. Dipasang di sini (bukan file baru) karena /api sudah
// di batas 12 Serverless Functions Vercel Hobby. Dibaca dari tabel yang SAMA
// dipakai grafik existing (lihat lib/db.js) supaya selalu sinkron. ----------
const AP_COLUMNS = ['teritip', 'kampung_damai', 'batu_ampar', 'km_12', 'gunung_tembak'];
const ATD_COLUMNS = ['kampung_damai', 'gunung_sari', 'prapatan', 'zamp', 'kampung_baru_ulu'];

// Ambil nilai non-null PERTAMA per kolom dari baris yang sudah diurutkan
// tanggal/bulan DESC -- tiap kolom bisa punya bulan terakhir terisi yang
// berbeda-beda, jadi tidak bisa ambil 1 baris teratas saja (pola sama dengan
// api/home-summary.js). Tanggal baris yang dipakai ikut disimpan per kolom
// (dari kolom `dateCol`, sudah di-to_char di query jadi string 'YYYY-MM-DD')
// supaya popup peta bisa tampilkan "Data per ...".
function firstNonNullPerColumn(rows, columns, dateCol) {
  const values = {};
  const dates = {};
  columns.forEach(col => { values[col] = null; dates[col] = null; });
  for (const row of rows) {
    for (const col of columns) {
      if (values[col] === null && row[col] !== null && row[col] !== undefined) {
        values[col] = Number(row[col]);
        dates[col] = row[dateCol];
      }
    }
    if (columns.every(col => values[col] !== null)) break;
  }
  return { values, dates };
}

// Versi efisien dari firstNonNullPerColumn untuk TANGAN LAPANGAN:
// hasil query DISTINCT ON (col) sudah berupa satu baris per kolom berisi
// nilai + tanggal terbaru yang non-null, jadi cukup disalin ke map. Kolom
// yang tidak punya data sama sekali di-set null, sama seperti perilaku
// firstNonNullPerColumn (kolom itu tidak pernah terisi).
function latestPerColumn(rows, columns) {
  const values = {};
  const dates = {};
  columns.forEach(col => { values[col] = null; dates[col] = null; });
  rows.forEach(r => {
    values[r.col] = r.value !== null && r.value !== undefined ? Number(r.value) : null;
    dates[r.col] = r.tanggal;
  });
  return { values, dates };
}

// Tanggal PALING BARU di antara beberapa tanggal (string 'YYYY-MM-DD', bisa
// null) -- dipakai supaya 1 kartu popup cukup tampilkan 1 keterangan
// "Data per ..." walau field-field di dalamnya berasal dari bulan yang beda.
function latestDate(...dates) {
  const valid = dates.filter(Boolean);
  return valid.length ? valid.reduce((a, b) => (a > b ? a : b)) : null;
}

// well_name di sumur_debit_readings/sumur_level_readings apa adanya dari
// header CSV lama (mis. "Sumur_01_Dalam_IPA", level pakai "Sumur_1_..." tanpa
// zero-pad -- lihat arsip apps/library/data/*.csv sebelum dimigrasi). Ambil
// nomornya saja supaya cocok dengan id di data/lokasi.json ("{installation}_{NN}").
function wellIdFromName(installation, wellName) {
  const m = String(wellName).match(/^Sumur_0*(\d+)_/i);
  if (!m) return null;
  return `${installation}_${m[1].padStart(2, '0')}`;
}

async function handleMapLatest(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const [apResult, atdResult, manggarResult, kualitasResult, teritipLevelResult, debitResult, levelResult] = await Promise.all([
    pool.query(`SELECT to_char(bulan, 'YYYY-MM-DD') as tanggal, ${AP_COLUMNS.join(', ')} FROM air_permukaan ORDER BY bulan DESC`),
    pool.query(`SELECT to_char(bulan, 'YYYY-MM-DD') as tanggal, ${ATD_COLUMNS.join(', ')} FROM air_tanah_dalam ORDER BY bulan DESC`),
    // Tabel harian besar dipindahkan seluruhnya tiap request publik padahal
    // yang dibutuhkan cuma nilai + tanggal terbaru per kolom. DISTINCT ON
    // (col) menarik SATU baris per kolom (nilai terbaru non-null) -- hasilnya
    // sama dengan firstNonNullPerColumn sebelumnya, tanpa transfer ribuan
    // baris harian.
    pool.query(`SELECT DISTINCT ON (col) col, to_char(tanggal, 'YYYY-MM-DD') as tanggal, value
                FROM (
                  SELECT 'level_waduk_manggar_m' AS col, tanggal, level_waduk_manggar_m AS value FROM manggar_level_curahhujan WHERE level_waduk_manggar_m IS NOT NULL
                  UNION ALL
                  SELECT 'curah_hujan_mm' AS col, tanggal, curah_hujan_mm AS value FROM manggar_level_curahhujan WHERE curah_hujan_mm IS NOT NULL
                ) x ORDER BY col, tanggal DESC`),
    pool.query(`SELECT DISTINCT ON (col) col, to_char(tanggal, 'YYYY-MM-DD') as tanggal, value
                FROM (
                  SELECT 'ntu_manggar' AS col, tanggal, ntu_manggar AS value FROM kualitas_air_manggar_teritip WHERE ntu_manggar IS NOT NULL
                  UNION ALL
                  SELECT 'ph_manggar' AS col, tanggal, ph_manggar AS value FROM kualitas_air_manggar_teritip WHERE ph_manggar IS NOT NULL
                  UNION ALL
                  SELECT 'ntu_teritip' AS col, tanggal, ntu_teritip AS value FROM kualitas_air_manggar_teritip WHERE ntu_teritip IS NOT NULL
                  UNION ALL
                  SELECT 'ph_teritip' AS col, tanggal, ph_teritip AS value FROM kualitas_air_manggar_teritip WHERE ph_teritip IS NOT NULL
                ) x ORDER BY col, tanggal DESC`),
    pool.query(`SELECT to_char(tanggal, 'YYYY-MM-DD') as tanggal, level_waduk_teritip_m FROM teritip_level WHERE level_waduk_teritip_m IS NOT NULL ORDER BY tanggal DESC LIMIT 1`),
    // Sumur dianggap aktif kalau ADA data debit yang diinput dalam 12 BULAN
    // TERAKHIR (lihat statusFromDebit di apps/peta-ipa-sumur/app.js) -- makanya
    // dibatasi ke jendela berjalan, bukan "debit terakhir kapan pun".
    //
    // Jendelanya harus sama persis dengan hitungan "Sumur Aktif" di
    // api/home-summary.js: dua-duanya tampil ke pemakai sebagai angka yang
    // sama, jadi kalau batasnya beda, peta dan beranda akan saling
    // bertentangan. Alasan memilih 12 bulan berjalan (bukan sejak awal tahun)
    // ditulis lengkap di berkas itu.
    pool.query(`SELECT DISTINCT ON (installation, well_name) installation, well_name, value, to_char(bulan, 'YYYY-MM-DD') as tanggal
                FROM sumur_debit_readings
                WHERE value IS NOT NULL
                  AND bulan >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'
                ORDER BY installation, well_name, bulan DESC`),
    pool.query(`SELECT DISTINCT ON (installation, well_name) installation, well_name, statis, dinamis, to_char(bulan, 'YYYY-MM-DD') as tanggal
                FROM sumur_level_readings WHERE statis IS NOT NULL OR dinamis IS NOT NULL
                ORDER BY installation, well_name, bulan DESC`)
  ]);

  const ap = firstNonNullPerColumn(apResult.rows, AP_COLUMNS, 'tanggal');
  const atd = firstNonNullPerColumn(atdResult.rows, ATD_COLUMNS, 'tanggal');
  const ipaIds = Array.from(new Set([...AP_COLUMNS, ...ATD_COLUMNS]));
  const ipa = {};
  ipaIds.forEach(id => {
    ipa[id] = {
      ap: ap.values[id] ?? null,
      atd: atd.values[id] ?? null,
      // AP_COLUMNS/ATD_COLUMNS mewakili instalasi yang MEMANG punya sumber
      // itu (mis. Gunung Sari tidak punya kolom AP sama sekali di skema --
      // bukan cuma belum diisi). Dipakai frontend buat bedakan "tidak ada"
      // vs "belum ada".
      apApplicable: AP_COLUMNS.includes(id),
      atdApplicable: ATD_COLUMNS.includes(id),
      tanggal: latestDate(ap.dates[id], atd.dates[id])
    };
  });

  const manggar = latestPerColumn(manggarResult.rows, ['level_waduk_manggar_m', 'curah_hujan_mm']);
  const kualitas = latestPerColumn(kualitasResult.rows, ['ntu_manggar', 'ph_manggar', 'ntu_teritip', 'ph_teritip']);
  const teritipLevelRow = teritipLevelResult.rows[0];
  const waduk = {
    manggar: {
      level: manggar.values.level_waduk_manggar_m,
      curahHujan: manggar.values.curah_hujan_mm,
      ntu: kualitas.values.ntu_manggar,
      ph: kualitas.values.ph_manggar,
      tanggal: latestDate(manggar.dates.level_waduk_manggar_m, manggar.dates.curah_hujan_mm, kualitas.dates.ntu_manggar, kualitas.dates.ph_manggar)
    },
    teritip: {
      level: teritipLevelRow ? Number(teritipLevelRow.level_waduk_teritip_m) : null,
      curahHujan: null,
      ntu: kualitas.values.ntu_teritip,
      ph: kualitas.values.ph_teritip,
      tanggal: latestDate(teritipLevelRow ? teritipLevelRow.tanggal : null, kualitas.dates.ntu_teritip, kualitas.dates.ph_teritip)
    }
  };

  const sumur = {};
  debitResult.rows.forEach(r => {
    const id = wellIdFromName(r.installation, r.well_name);
    if (!id) return;
    if (!sumur[id]) sumur[id] = { statis: null, dinamis: null, debit: null, tanggal: null };
    sumur[id].debit = Number(r.value);
    sumur[id].tanggal = latestDate(sumur[id].tanggal, r.tanggal);
  });
  levelResult.rows.forEach(r => {
    const id = wellIdFromName(r.installation, r.well_name);
    if (!id) return;
    if (!sumur[id]) sumur[id] = { statis: null, dinamis: null, debit: null, tanggal: null };
    sumur[id].statis = r.statis !== null && r.statis !== undefined ? Number(r.statis) : null;
    sumur[id].dinamis = r.dinamis !== null && r.dinamis !== undefined ? Number(r.dinamis) : null;
    sumur[id].tanggal = latestDate(sumur[id].tanggal, r.tanggal);
  });

  return res.status(200).json({ ipa, sumur, waduk });
}

// --- action=map-lokasi: titik peta yang dipegang admin, yaitu titik BARU dan
// KOREKSI koordinat titik lama (lihat ensurePetaTables di lib/db.js).
// Endpoint PUBLIK, sepasang dengan map-latest: halaman peta memang terbuka,
// dan yang dikirim di sini cuma nama + koordinat -- sama isinya dengan
// data/lokasi.json yang juga terbuka. Panggilan requireAdmin di bawah harus
// tetap DILEWATI, karena itu handler ini didaftarkan sebelum requireAdmin di
// module.exports. ---------------------------------------------------------
async function handleMapLokasi(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  await ensurePetaTables();
  const { rows } = await pool.query(
    `SELECT jenis, lokasi_id, nama, installation, lat, lng, keterangan
       FROM peta_lokasi ORDER BY jenis, nama`
  );
  return res.status(200).json({ rows: rows.map(r => Object.assign({}, r)) });
}

// --- action=daily: input harian Waduk Manggar/Teritip (Level, Curah Hujan,
// Kekeruhan, PH), langsung ke Postgres. ---------------------------------
const DAILY_FIELD_MAP = {
  manggar: { level: 'manggar_level', hujan: 'manggar_hujan', ntu: 'manggar_ntu', ph: 'manggar_ph' },
  teritip: { level: 'teritip_level', ntu: 'teritip_ntu', ph: 'teritip_ph' }
};

async function handleDaily(req, res) {
  if (req.method === 'GET') {
    const { group, tanggal } = req.query;
    if (!DAILY_FIELD_MAP[group] || !tanggal) {
      return res.status(400).json({ error: 'group (manggar/teritip) dan tanggal wajib diisi' });
    }
    const values = {};
    for (const [field, key] of Object.entries(DAILY_FIELD_MAP[group])) {
      const source = DATASETS[key];
      const { rows } = await pool.query(
        `SELECT ${source.col} FROM ${source.table} WHERE ${source.dateCol} = $1`,
        [tanggal]
      );
      const v = rows[0] ? rows[0][source.col] : null;
      values[field] = v !== null && v !== undefined ? Number(v) : '';
    }
    return res.status(200).json({ found: Object.values(values).some(v => v !== ''), values });
  }

  if (req.method === 'POST') {
    const { group, tanggal, ...fields } = req.body || {};
    if (!DAILY_FIELD_MAP[group] || !tanggal) {
      return res.status(400).json({ error: 'group (manggar/teritip) dan tanggal wajib diisi' });
    }

    // Kelompokkan field yang diisi berdasarkan tabel tujuan -- beberapa
    // field (ntu/ph Manggar & Teritip) berbagi 1 tabel (kualitas_air_manggar_teritip).
    const byTable = {};
    for (const [field, key] of Object.entries(DAILY_FIELD_MAP[group])) {
      if (!(field in fields) || fields[field] === '' || fields[field] === undefined) continue;
      const source = DATASETS[key];
      if (!byTable[source.table]) byTable[source.table] = { dateCol: source.dateCol, cols: {} };
      byTable[source.table].cols[source.col] = toNumOrNull(fields[field]);
    }

    for (const [table, info] of Object.entries(byTable)) {
      const colNames = Object.keys(info.cols);
      const colValues = Object.values(info.cols);
      const placeholders = colValues.map((_, i) => `$${i + 2}`);
      const updateSet = colNames.map(c => `${c} = EXCLUDED.${c}`).join(', ');
      await pool.query(
        `INSERT INTO ${table} (${info.dateCol}, ${colNames.join(', ')}) VALUES ($1, ${placeholders.join(', ')})
         ON CONFLICT (${info.dateCol}) DO UPDATE SET ${updateSet}`,
        [tanggal, ...colValues]
      );
    }

    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const { group, tanggal } = req.query;
    if (!DAILY_FIELD_MAP[group] || !tanggal) {
      return res.status(400).json({ error: 'group (manggar/teritip) dan tanggal wajib diisi' });
    }

    // Set NULL kolom-kolom milik grup ini saja -- tabel seperti
    // kualitas_air_manggar_teritip dipakai bersama Manggar & Teritip, jadi
    // TIDAK boleh menyentuh kolom milik grup lain di baris yang sama.
    const byTable = groupFieldsByTable(DAILY_FIELD_MAP[group]);
    for (const [table, info] of Object.entries(byTable)) {
      const setClause = info.cols.map(c => `${c.col} = NULL`).join(', ');
      await pool.query(`UPDATE ${table} SET ${setClause} WHERE ${info.dateCol} = $1`, [tanggal]);
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// Kelompokkan field (level/hujan/ntu/ph) satu grup berdasarkan tabel tujuan
// masing-masing -- dipakai handleDaily (DELETE) & handleDailyHistory (GET).
function groupFieldsByTable(fieldMap) {
  const byTable = {};
  for (const [field, key] of Object.entries(fieldMap)) {
    const source = DATASETS[key];
    if (!byTable[source.table]) byTable[source.table] = { dateCol: source.dateCol, cols: [] };
    byTable[source.table].cols.push({ field, col: source.col });
  }
  return byTable;
}

// --- action=daily-history: riwayat tanggal yang sudah terinput untuk satu
// grup (Manggar/Teritip), digabung per tanggal dari semua tabel yang
// berkontribusi. Data kecil (puluhan-ratusan baris/tahun) jadi tidak perlu
// pagination -- filter/sort tanggal dilakukan di frontend. -------------------
async function handleDailyHistory(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { group } = req.query;
  if (!DAILY_FIELD_MAP[group]) {
    return res.status(400).json({ error: 'group (manggar/teritip) wajib diisi' });
  }

  const byTable = groupFieldsByTable(DAILY_FIELD_MAP[group]);
  const merged = new Map(); // tanggal -> { field: value|null }

  for (const [table, info] of Object.entries(byTable)) {
    const selectCols = info.cols.map(c => c.col).join(', ');
    const { rows } = await pool.query(
      `SELECT to_char(${info.dateCol}, 'YYYY-MM-DD') as tanggal, ${selectCols} FROM ${table}`
    );
    for (const row of rows) {
      if (!merged.has(row.tanggal)) merged.set(row.tanggal, {});
      const entry = merged.get(row.tanggal);
      for (const { field, col } of info.cols) {
        const v = row[col];
        entry[field] = v !== null && v !== undefined ? Number(v) : null;
      }
    }
  }

  const allFields = Object.keys(DAILY_FIELD_MAP[group]);
  const outRows = Array.from(merged.entries())
    .map(([tanggal, values]) => {
      const full = {};
      allFields.forEach(f => { full[f] = Object.prototype.hasOwnProperty.call(values, f) ? values[f] : null; });
      return { tanggal, values: full };
    })
    .sort((a, b) => (a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : 0));

  return res.status(200).json({ rows: outRows });
}

// --- action=sumur: input bulanan Sumur Dalam (Debit / Statis-Dinamis) ----
async function handleSumur(req, res) {
  const { installation, category } = req.query;
  if (!installation || !['debit', 'level'].includes(category)) {
    return res.status(400).json({ error: 'installation dan category (debit/level) wajib diisi' });
  }

  if (req.method === 'GET') {
    const { bulan } = req.query;
    if (!bulan) return res.status(400).json({ error: 'bulan wajib diisi' });
    const bulanDate = `${bulan}-01`;
    const wells = await fetchSumurWells(installation, category);

    if (category === 'debit') {
      const { rows } = await pool.query(
        'SELECT well_name, value FROM sumur_debit_readings WHERE installation = $1 AND bulan = $2',
        [installation, bulanDate]
      );
      const values = {};
      rows.forEach(r => { values[r.well_name] = r.value !== null ? Number(r.value) : ''; });
      return res.status(200).json({ wells, values });
    }

    const { rows } = await pool.query(
      'SELECT well_name, statis, dinamis FROM sumur_level_readings WHERE installation = $1 AND bulan = $2',
      [installation, bulanDate]
    );
    const values = {};
    rows.forEach(r => {
      values[r.well_name] = {
        statis: r.statis !== null ? Number(r.statis) : '',
        dinamis: r.dinamis !== null ? Number(r.dinamis) : ''
      };
    });
    return res.status(200).json({ wells, values });
  }

  if (req.method === 'POST') {
    const { bulan, values } = req.body || {};
    if (!bulan || !values) return res.status(400).json({ error: 'bulan dan values wajib diisi' });
    const bulanDate = `${bulan}-01`;

    if (category === 'debit') {
      for (const [well, raw] of Object.entries(values)) {
        await pool.query(
          `INSERT INTO sumur_debit_readings (installation, well_name, bulan, value) VALUES ($1, $2, $3, $4)
           ON CONFLICT (installation, well_name, bulan) DO UPDATE SET value = EXCLUDED.value`,
          [installation, well, bulanDate, toNumOrNull(raw)]
        );
      }
    } else {
      for (const [well, pair] of Object.entries(values)) {
        await pool.query(
          `INSERT INTO sumur_level_readings (installation, well_name, bulan, statis, dinamis) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (installation, well_name, bulan) DO UPDATE SET statis = EXCLUDED.statis, dinamis = EXCLUDED.dinamis`,
          [installation, well, bulanDate, toNumOrNull(pair && pair.statis), toNumOrNull(pair && pair.dinamis)]
        );
      }
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// --- action=sumur-history: riwayat bulan yang sudah terinput untuk satu
// instalasi+kategori Sumur Dalam, digabung per bulan (1 baris/bulan, 1 kolom
// per sumur terdaftar). Sama seperti action=daily-history: data kecil, tidak
// perlu pagination, filter/sort dilakukan di frontend. ----------------------
async function handleSumurHistory(req, res) {
  const { installation, category } = req.query;
  if (!installation || !['debit', 'level'].includes(category)) {
    return res.status(400).json({ error: 'installation dan category (debit/level) wajib diisi' });
  }

  if (req.method === 'GET') {
    const wells = await fetchSumurWells(installation, category);
    const byBulan = new Map(); // bulan -> { well_name: value | {statis,dinamis} }

    if (category === 'debit') {
      const { rows } = await pool.query(
        `SELECT well_name, to_char(bulan, 'YYYY-MM') as bulan, value FROM sumur_debit_readings WHERE installation = $1`,
        [installation]
      );
      rows.forEach(r => {
        if (!byBulan.has(r.bulan)) byBulan.set(r.bulan, {});
        byBulan.get(r.bulan)[r.well_name] = r.value !== null && r.value !== undefined ? Number(r.value) : null;
      });
    } else {
      const { rows } = await pool.query(
        `SELECT well_name, to_char(bulan, 'YYYY-MM') as bulan, statis, dinamis FROM sumur_level_readings WHERE installation = $1`,
        [installation]
      );
      rows.forEach(r => {
        if (!byBulan.has(r.bulan)) byBulan.set(r.bulan, {});
        byBulan.get(r.bulan)[r.well_name] = {
          statis: r.statis !== null && r.statis !== undefined ? Number(r.statis) : null,
          dinamis: r.dinamis !== null && r.dinamis !== undefined ? Number(r.dinamis) : null
        };
      });
    }

    const emptyValue = category === 'debit' ? null : { statis: null, dinamis: null };
    const outRows = Array.from(byBulan.entries())
      .map(([bulan, values]) => {
        const full = {};
        wells.forEach(w => { full[w] = Object.prototype.hasOwnProperty.call(values, w) ? values[w] : emptyValue; });
        return { bulan, values: full };
      })
      .sort((a, b) => (a.bulan < b.bulan ? 1 : a.bulan > b.bulan ? -1 : 0));

    return res.status(200).json({ wells, rows: outRows });
  }

  if (req.method === 'DELETE') {
    const { bulan } = req.query;
    if (!bulan) return res.status(400).json({ error: 'bulan wajib diisi' });
    const bulanDate = `${bulan}-01`;

    if (category === 'debit') {
      await pool.query('UPDATE sumur_debit_readings SET value = NULL WHERE installation = $1 AND bulan = $2', [installation, bulanDate]);
    } else {
      await pool.query('UPDATE sumur_level_readings SET statis = NULL, dinamis = NULL WHERE installation = $1 AND bulan = $2', [installation, bulanDate]);
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// --- action=bulk: simpan BANYAK baris sekaligus (tab "Input Massal" di
// apps/input-data-historis.html). Sengaja dibuat terpisah dari action=daily /
// action=sumur -- form input satu-per-satu yang lama tetap hidup apa adanya,
// dua cara input berdampingan.
//
// Aturan yang membedakan endpoint ini dari yang lama: SEL KOSONG TIDAK PERNAH
// MENGHAPUS. Di lapangan satu tanggal diisi dua orang (Level & Curah Hujan
// Manggar dicatat petugas waduk, NTU & PH menyusul dari sub-divisi lain), jadi
// tempelan yang cuma berisi kolom NTU/PH harus membiarkan Level & Curah Hujan
// tanggal itu apa adanya. Diwujudkan lewat COALESCE(EXCLUDED.x, tabel.x) di
// klausa ON CONFLICT: nilai baru menang kalau ada isinya, nilai lama bertahan
// kalau sel yang ditempel kosong. Konsekuensinya, mengosongkan nilai TIDAK
// bisa lewat sini -- itu tetap lewat tombol 🗑️ di form lama, dan memang lebih
// aman begitu.
const BULK_DAILY_KEYS = ['manggar_level', 'manggar_hujan', 'manggar_ntu', 'manggar_ph',
                         'teritip_level', 'teritip_ntu', 'teritip_ph'];

// Batas per permintaan. Bukan batas jumlah data yang bisa diimpor -- frontend
// memecah tempelan panjang jadi beberapa kiriman -- cuma penjaga supaya satu
// statement tidak melar sampai kena batas 10 detik fungsi Vercel.
const BULK_MAX_ROWS = 500;

function isIsoDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isIsoMonth(s) { return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s); }

// Satu INSERT multi-baris, bukan perulangan pool.query per baris: 300 baris
// harian x round-trip serverless->Neon satu per satu tidak akan selesai dalam
// batas waktu fungsi.
async function bulkUpsert(client, table, dateCol, cols, rows) {
  const params = [];
  const tuples = rows.map(r => {
    const ph = [`$${params.push(r.date)}::date`];
    cols.forEach(c => ph.push(`$${params.push(r.values[c] !== undefined ? r.values[c] : null)}::numeric`));
    return `(${ph.join(', ')})`;
  });
  const updateSet = cols.map(c => `${c} = COALESCE(EXCLUDED.${c}, ${table}.${c})`).join(', ');
  await client.query(
    `INSERT INTO ${table} (${dateCol}, ${cols.join(', ')}) VALUES ${tuples.join(', ')}
     ON CONFLICT (${dateCol}) DO UPDATE SET ${updateSet}`,
    params
  );
}

async function bulkDaily(req, res) {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows wajib diisi' });
  }
  if (rows.length > BULK_MAX_ROWS) {
    return res.status(400).json({ error: `Maksimal ${BULK_MAX_ROWS} baris sekali kirim` });
  }

  // Kelompokkan per tabel tujuan -- satu tanggal bisa menyentuh dua tabel
  // sekaligus (Level ke manggar_level_curahhujan, NTU/PH ke
  // kualitas_air_manggar_teritip). Tanggal yang muncul dua kali dalam satu
  // tempelan digabung (yang belakangan menang) karena satu statement INSERT
  // ... ON CONFLICT DO UPDATE dilarang menyentuh baris yang sama dua kali.
  const byTable = new Map(); // table -> { dateCol, cols:Set, rows:Map(tanggal -> {col:num}) }
  const tanggalTersentuh = new Set();
  let dilewati = 0;

  for (const r of rows) {
    if (!r || !isIsoDate(r.tanggal)) { dilewati++; continue; }
    const values = r.values || {};
    for (const key of Object.keys(values)) {
      if (!BULK_DAILY_KEYS.includes(key)) continue;
      const num = toNumOrNull(values[key]);
      if (num === null) continue; // sel kosong: lewati, jangan tulis NULL
      const src = DATASETS[key];
      if (!byTable.has(src.table)) {
        byTable.set(src.table, { dateCol: src.dateCol, cols: new Set(), rows: new Map() });
      }
      const t = byTable.get(src.table);
      t.cols.add(src.col);
      if (!t.rows.has(r.tanggal)) t.rows.set(r.tanggal, {});
      t.rows.get(r.tanggal)[src.col] = num;
      tanggalTersentuh.add(r.tanggal);
    }
  }

  if (byTable.size === 0) {
    return res.status(400).json({ error: 'Tidak ada nilai yang bisa disimpan dari data yang dikirim.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [table, t] of byTable) {
      const cols = Array.from(t.cols);
      const list = Array.from(t.rows.entries()).map(([date, values]) => ({ date, values }));
      await bulkUpsert(client, table, t.dateCol, cols, list);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: 'Gagal menyimpan: ' + err.message });
  } finally {
    client.release();
  }

  return res.status(200).json({ success: true, tanggal: tanggalTersentuh.size, dilewati });
}

async function bulkSumur(req, res) {
  const { installation, category } = req.query;
  if (!installation || !['debit', 'level'].includes(category)) {
    return res.status(400).json({ error: 'installation dan category (debit/level) wajib diisi' });
  }
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows wajib diisi' });
  }
  if (rows.length > BULK_MAX_ROWS) {
    return res.status(400).json({ error: `Maksimal ${BULK_MAX_ROWS} baris sekali kirim` });
  }

  // Cuma sumur yang sudah terdaftar di sumur_wells yang diterima. Nama yang
  // tidak dikenal dikembalikan ke frontend supaya admin bisa mendaftarkannya
  // dulu -- lebih baik ditolak terang-terangan daripada diam-diam bikin baris
  // data yatim yang tidak pernah muncul di grafik mana pun.
  const terdaftar = new Set(await fetchSumurWells(installation, category));
  const takDikenal = new Set();
  const byKey = new Map(); // `${well}|${bulan}` -> { well, bulan, statis?, dinamis?, value? }
  const bulanTersentuh = new Set();
  let dilewati = 0;

  for (const r of rows) {
    if (!r || !isIsoMonth(r.bulan)) { dilewati++; continue; }
    const values = r.values || {};
    for (const well of Object.keys(values)) {
      if (!terdaftar.has(well)) { takDikenal.add(well); continue; }
      const raw = values[well];
      const entry = { well, bulan: `${r.bulan}-01` };
      if (category === 'debit') {
        const v = toNumOrNull(raw);
        if (v === null) continue;
        entry.value = v;
      } else {
        const statis = toNumOrNull(raw && raw.statis);
        const dinamis = toNumOrNull(raw && raw.dinamis);
        if (statis === null && dinamis === null) continue;
        entry.statis = statis;
        entry.dinamis = dinamis;
      }
      byKey.set(`${well}|${r.bulan}`, entry);
      bulanTersentuh.add(r.bulan);
    }
  }

  if (byKey.size === 0) {
    return res.status(400).json({
      error: takDikenal.size > 0
        ? `Tidak ada nilai yang bisa disimpan. Nama sumur yang tidak dikenal: ${Array.from(takDikenal).join(', ')}`
        : 'Tidak ada nilai yang bisa disimpan dari data yang dikirim.',
      takDikenal: Array.from(takDikenal)
    });
  }

  const entries = Array.from(byKey.values());
  const params = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (category === 'debit') {
      const tuples = entries.map(e =>
        `($${params.push(installation)}, $${params.push(e.well)}, $${params.push(e.bulan)}::date, $${params.push(e.value)}::numeric)`
      );
      await client.query(
        `INSERT INTO sumur_debit_readings (installation, well_name, bulan, value) VALUES ${tuples.join(', ')}
         ON CONFLICT (installation, well_name, bulan)
         DO UPDATE SET value = COALESCE(EXCLUDED.value, sumur_debit_readings.value)`,
        params
      );
    } else {
      const tuples = entries.map(e =>
        `($${params.push(installation)}, $${params.push(e.well)}, $${params.push(e.bulan)}::date, ` +
        `$${params.push(e.statis)}::numeric, $${params.push(e.dinamis)}::numeric)`
      );
      await client.query(
        `INSERT INTO sumur_level_readings (installation, well_name, bulan, statis, dinamis) VALUES ${tuples.join(', ')}
         ON CONFLICT (installation, well_name, bulan)
         DO UPDATE SET statis = COALESCE(EXCLUDED.statis, sumur_level_readings.statis),
                       dinamis = COALESCE(EXCLUDED.dinamis, sumur_level_readings.dinamis)`,
        params
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: 'Gagal menyimpan: ' + err.message });
  } finally {
    client.release();
  }

  return res.status(200).json({
    success: true,
    bulan: bulanTersentuh.size,
    nilai: entries.length,
    dilewati,
    takDikenal: Array.from(takDikenal)
  });
}

async function handleBulk(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { kind } = req.query;
  if (kind === 'daily') return bulkDaily(req, res);
  if (kind === 'sumur') return bulkSumur(req, res);
  return res.status(400).json({ error: 'kind wajib diisi (daily/sumur)' });
}

// --- action=wells: CRUD daftar sumur aktif per instalasi ------------------
async function handleWells(req, res) {
  if (req.method === 'GET') {
    const { installation, category } = req.query;
    if (!installation || !['debit', 'level'].includes(category)) {
      return res.status(400).json({ error: 'installation dan category (debit/level) wajib diisi' });
    }
    const { rows } = await pool.query(
      'SELECT well_name FROM sumur_wells WHERE installation = $1 AND category = $2 ORDER BY sort_order, well_name',
      [installation, category]
    );
    return res.status(200).json({ wells: rows.map(r => r.well_name) });
  }

  if (req.method === 'POST') {
    const { installation, category, wellName } = req.body || {};

    // Toggle status aktif sumur (dipakai panel "Daftar Sumur & Status Aktif"
    // di KPI 18.1a -- ANGG cuma menghitung sumur AKTIF). Tidak menghapus
    // sumur, jadi data lamanya tetap ada.
    if (req.body && req.body.action === 'set_active') {
      if (!installation || !['debit', 'level'].includes(category) || !wellName || !String(wellName).trim()) {
        return res.status(400).json({ error: 'installation, category, dan wellName wajib diisi' });
      }
      await pool.query(
        'UPDATE sumur_wells SET active = $1 WHERE installation = $2 AND category = $3 AND well_name = $4',
        [!!req.body.active, installation, category, String(wellName).trim()]
      );
      return res.status(200).json({ success: true });
    }

    if (!installation || !['debit', 'level'].includes(category) || !wellName || !String(wellName).trim()) {
      return res.status(400).json({ error: 'installation, category, dan wellName wajib diisi' });
    }
    const { rows } = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM sumur_wells WHERE installation = $1 AND category = $2',
      [installation, category]
    );
    await pool.query(
      `INSERT INTO sumur_wells (installation, category, well_name, sort_order) VALUES ($1, $2, $3, $4)
       ON CONFLICT (installation, category, well_name) DO NOTHING`,
      [installation, category, String(wellName).trim(), rows[0].next_order]
    );
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const { installation, category, wellName } = req.query;
    if (!installation || !['debit', 'level'].includes(category) || !wellName) {
      return res.status(400).json({ error: 'installation, category, dan wellName wajib diisi' });
    }
    await pool.query(
      'DELETE FROM sumur_wells WHERE installation = $1 AND category = $2 AND well_name = $3',
      [installation, category, wellName]
    );
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// --- action=signers: CRUD Nama 2 -> Jabatan & Tindak Lanjut baku untuk
// apps/berita-acara.html. nama dipakai sebagai primary key (case-sensitive
// apa adanya) -- pencocokan case-insensitive/partial dilakukan di frontend,
// bukan di query ini. -------------------------------------------------------
async function handleSigners(req, res) {
  await ensureSignersTable();

  if (req.method === 'GET') {
    const { rows } = await pool.query(
      'SELECT nama, jabatan, tindak_lanjut FROM berita_acara_signers ORDER BY nama'
    );
    return res.status(200).json({
      signers: rows.map(r => ({ nama: r.nama, jabatan: r.jabatan || '', tindakLanjut: r.tindak_lanjut || '' }))
    });
  }

  if (req.method === 'POST') {
    const { nama, jabatan, tindakLanjut } = req.body || {};
    if (!nama || !String(nama).trim()) {
      return res.status(400).json({ error: 'nama wajib diisi' });
    }
    await pool.query(
      `INSERT INTO berita_acara_signers (nama, jabatan, tindak_lanjut, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (nama) DO UPDATE SET jabatan = EXCLUDED.jabatan, tindak_lanjut = EXCLUDED.tindak_lanjut, updated_at = now()`,
      [String(nama).trim(), jabatan || '', tindakLanjut || '']
    );
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const { nama } = req.query;
    if (!nama) return res.status(400).json({ error: 'nama wajib diisi' });
    await pool.query('DELETE FROM berita_acara_signers WHERE nama = $1', [nama]);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// --- action=spd: template & nomor berikutnya untuk mode admin di apps/spd.html
// Yang dilayani di sini (semua khusus admin):
//   GET                      -> kop, daftar template kode perk & penandatangan,
//                               dan nomor berikutnya untuk tahun ?tahun=
//   POST &what=template      -> upsert satu template (atau baris kop)
//   DELETE &what=template    -> hapus satu template
// Riwayat suratnya sendiri TIDAK di sini -- tetap lewat /api/history seperti
// halaman surat lain, supaya ikut muncul di Dashboard Admin.

// Nilai awal yang ditanam sekali saat tabel masih benar-benar kosong. Diambil
// dari contoh yang memang sudah dipakai di apps/spd.html, jadi halaman admin
// langsung bisa dipakai tanpa mengisi template dari nol. Karena baris 'kop'
// ikut ditanam, tabel tidak akan pernah kosong lagi -- template yang dihapus
// admin tidak akan muncul kembali.
const SPD_DEFAULT_KOP = {
  kodeUnit: '00.08.08',
  nomorTengah: '1421002/7a-I',
  nomorSuffix: '-O',
  footerCode: 'PTMBPP-QR-KEU.AKTN/01-04'
};
const SPD_SEED = [
  { id: 'kop', jenis: 'kop', urutan: 0, data: SPD_DEFAULT_KOP },
  { id: 'kp-retribusi', jenis: 'kode_perk', urutan: 0,
    data: { label: 'Retribusi Air Baku', kode: '91.01.31', uraian: 'Biaya retribusi air baku bulan berjalan' } },
  { id: 'sg-standar', jenis: 'penandatangan', urutan: 0,
    data: {
      nama: 'Standar SAB',
      manajerNama: 'DEDY HERMAWAN, S.M', manajerJabatan: 'Manajer Produksi',
      supervisorNama: 'DARTO', supervisorJabatan: 'Supervisor Sumber Air Baku',
      direkturNama: 'Ir. ALI RACHMAN AS, S.T., M.T.', direkturJabatan: 'Direktur Operasional'
    } }
];

async function seedSpdIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM spd_templates');
  if (rows[0].n > 0) return;
  for (const t of SPD_SEED) {
    await pool.query(
      `INSERT INTO spd_templates (id, jenis, urutan, data) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, t.jenis, t.urutan, JSON.stringify(t.data)]
    );
  }
}

function spdTahun(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 1900 && n < 3000 ? n : new Date().getFullYear();
}

// Nomor berikutnya = nomor SPD TERBESAR yang sudah ada di riwayat tahun itu,
// ditambah satu. Tidak ada counter terpisah, jadi angkanya selalu sinkron
// dengan yang benar-benar tercatat: menghapus entri riwayat otomatis
// membebaskan nomornya lagi, dan SPD yang batal diunduh tidak menyisakan
// lubang nomor.
//
// details->>'nomorUrut' disaring dengan regex angka dulu sebelum di-cast:
// tabel history dipakai bersama semua jenis surat (dan entri "halaman
// dibuka" yang detailsnya cuma { accessedAt }), jadi tidak semua baris
// punya nomorUrut yang bisa dijadikan angka. Nomor tersimpan ter-zero-pad
// ('01'), dan '01'::int tetap 1 -- aman.
async function spdNomorBerikutnya(tahun) {
  await ensureHistoryTable();
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX((details->>'nomorUrut')::int), 0) AS maks
       FROM history
      WHERE document_type = 'SPD'
        AND details->>'nomorUrut' ~ '^[0-9]+$'
        AND details->>'tanggal' LIKE $1`,
    [`${tahun}-%`]
  );
  return Number(rows[0].maks) + 1;
}

async function handleSpd(req, res) {
  await ensureSpdTables();

  if (req.method === 'GET') {
    await seedSpdIfEmpty();
    const tahun = spdTahun(req.query.tahun);
    const [{ rows: tplRows }, nextNomor] = await Promise.all([
      pool.query('SELECT id, jenis, urutan, data FROM spd_templates ORDER BY urutan, id'),
      spdNomorBerikutnya(tahun)
    ]);

    const kopRow = tplRows.find(r => r.jenis === 'kop');
    return res.status(200).json({
      kop: Object.assign({}, SPD_DEFAULT_KOP, kopRow ? kopRow.data : {}),
      kodePerk: tplRows.filter(r => r.jenis === 'kode_perk').map(r => Object.assign({ id: r.id }, r.data)),
      penandatangan: tplRows.filter(r => r.jenis === 'penandatangan').map(r => Object.assign({ id: r.id }, r.data)),
      tahun,
      nextNomor
    });
  }

  if (req.method === 'POST' && req.query.what === 'template') {
    const { id, jenis, urutan, data } = req.body || {};
    if (!jenis || !['kode_perk', 'penandatangan', 'kop'].includes(jenis)) {
      return res.status(400).json({ error: 'jenis harus kode_perk/penandatangan/kop' });
    }
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data wajib diisi' });
    const rowId = jenis === 'kop' ? 'kop' : (id || `${jenis}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await pool.query(
      `INSERT INTO spd_templates (id, jenis, urutan, data, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET jenis = EXCLUDED.jenis, urutan = EXCLUDED.urutan,
                                      data = EXCLUDED.data, updated_at = now()`,
      [rowId, jenis, Number(urutan) || 0, JSON.stringify(data)]
    );
    return res.status(200).json({ success: true, id: rowId });
  }

  if (req.method === 'DELETE' && req.query.what === 'template') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id wajib diisi' });
    if (id === 'kop') return res.status(400).json({ error: 'baris kop tidak bisa dihapus' });
    await pool.query('DELETE FROM spd_templates WHERE id = $1', [id]);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method/what tidak dikenal (what=template)' });
}

// --- action=lpj: template penandatangan bersama untuk apps/lpj.html --------
// LPJ tidak punya nomor urut (nomor voucher diketik manual dari buku kas),
// jadi yang perlu dibagi antar admin cuma daftar penandatangannya. Riwayat
// suratnya tetap lewat /api/history seperti jenis surat lain.
//
// Tabelnya menumpang spd_templates -- bentuknya memang generik (id/jenis/
// urutan/data) dan jenis 'lpj_*' tidak pernah dibaca handleSpd (yang selalu
// memfilter 'kop'/'kode_perk'/'penandatangan'), jadi tidak perlu tabel baru.
const LPJ_SIGNER_DEFAULT = {
  nama: 'Standar SAB',
  pemeriksaNama: 'DEDY HERMAWAN, S.M', pemeriksaJabatan: 'Manajer Produksi',
  pembuatNama: 'DARTO', pembuatJabatan: 'Supervisor Sumber Air Baku',
  penyetujuNama: 'Ir. ALI RACHMAN AS, S.T., M.T.', penyetujuJabatan: 'Direktur Operasional'
};

// Baris penanda 'lpj-seed' sengaja ikut ditanam: tanpa itu, admin yang
// menghapus semua template penandatangan akan melihat template bawaan muncul
// lagi setiap halaman dibuka.
async function seedLpjIfNeeded() {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM spd_templates WHERE id = 'lpj-seed'"
  );
  if (rows[0].n > 0) return;
  await pool.query(
    `INSERT INTO spd_templates (id, jenis, urutan, data) VALUES
       ('lpj-seed', 'lpj_meta', 0, $1),
       ('lpj-sg-standar', 'lpj_penandatangan', 0, $2)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify({ seeded: true }), JSON.stringify(LPJ_SIGNER_DEFAULT)]
  );
}

async function handleLpj(req, res) {
  await ensureSpdTables();

  if (req.method === 'GET') {
    await seedLpjIfNeeded();
    const { rows } = await pool.query(
      "SELECT id, urutan, data FROM spd_templates WHERE jenis = 'lpj_penandatangan' ORDER BY urutan, id"
    );
    return res.status(200).json({
      penandatangan: rows.map(r => Object.assign({ id: r.id }, r.data))
    });
  }

  if (req.method === 'POST' && req.query.what === 'template') {
    const { id, urutan, data } = req.body || {};
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data wajib diisi' });
    const rowId = id || `lpj-sg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await pool.query(
      `INSERT INTO spd_templates (id, jenis, urutan, data, updated_at)
       VALUES ($1, 'lpj_penandatangan', $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET jenis = 'lpj_penandatangan', urutan = EXCLUDED.urutan,
                                      data = EXCLUDED.data, updated_at = now()`,
      [rowId, Number(urutan) || 0, JSON.stringify(data)]
    );
    return res.status(200).json({ success: true, id: rowId });
  }

  if (req.method === 'DELETE' && req.query.what === 'template') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id wajib diisi' });
    await pool.query("DELETE FROM spd_templates WHERE id = $1 AND jenis = 'lpj_penandatangan'", [id]);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method/what tidak dikenal (what=template)' });
}

// ===========================================================================
// action=sumber -- Daftar Sumber Air Baku (apps/sumber-air-baku)
// ===========================================================================
// CRUD detail waduk & sumur. Daftar lokasi (nama + koordinat) dipegang
// client dari data/lokasi.json -- di sini cuma detail referensi + lampiran.
// Foto waduk & lampiran sumur (data logging, pumping test) ditaruh di Vercel
// Blob; yang disimpan di DB cuma url + pathname (pola sama tabel galeri).
//
//   GET    ?action=sumber&jenis=sumur&id=<id>[&context=1]  -> { detail, auto }
//   GET    ?action=sumber&jenis=waduk&id=<id>              -> { detail }
//   POST   ?action=sumber  body:{jenis, id, nama, ...fields, *_dataUrl, hapus*}
//   DELETE ?action=sumber&jenis=waduk|sumur&id=<id>

// Data URL yang diterima lampiran: foto (jpeg/png/webp) atau PDF.
const POLA_LAMPIRAN = /^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/=]+)$/;
const MAKS_LAMPIRAN = 4 * 1024 * 1024;

function teksSumber(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// Nomor & instalasi dari id "{installation}_{NN}" (buat cocok ke no di
// kpi_9_7_items yang memakai nomor sumur dari data web). Aturannya sekarang
// tinggal di lib/visualization/sumur-well.js -- dulu disalin di sini, dan
// salinan aturan penamaan sumur itu yang bikin bug 'teritip_1' vs 'teritip_01'.
const nomorDariSumurId = nomorDariId;
const installationDariSumurId = installationDariId;

// Unggah satu lampiran (data URL) ke Vercel Blob. Kembalikan { url, pathname }
// atau { error }. kalau dataUrl kosong -> null (tidak ada lampiran baru).
async function unggahLampiran(dataUrl, folder) {
  if (dataUrl === undefined || dataUrl === null || dataUrl === '') return null;
  const cocok = POLA_LAMPIRAN.exec(String(dataUrl));
  if (!cocok) return { error: 'File harus berupa foto (JPEG/PNG/WEBP) atau PDF.' };
  const tipe = cocok[1];
  const isi = Buffer.from(cocok[2], 'base64');
  if (!isi.length) return { error: 'Isi file kosong.' };
  if (isi.length > MAKS_LAMPIRAN) return { error: 'File terlalu besar, maksimal 4 MB.' };
  const ekst = tipe === 'image/jpeg' ? 'jpg' : tipe === 'application/pdf' ? 'pdf' : tipe.split('/')[1];
  try {
    const hasil = await put(`sumber/${folder}/${Date.now()}-${ekst}`, isi, {
      access: 'public', contentType: tipe, addRandomSuffix: true
    });
    return { url: hasil.url, pathname: hasil.pathname };
  } catch (err) {
    return {
      error: process.env.BLOB_READ_WRITE_TOKEN
        ? 'Gagal mengunggah file ke penyimpanan: ' + err.message
        : 'Penyimpanan file belum aktif. Buat Blob Store di dashboard Vercel dulu.'
    };
  }
}

async function hapusBlobSumber(pathname) {
  if (!pathname) return;
  try { await del(pathname); } catch (e) { /* diabaikan: file bisa sudah hilang */ }
}

// Baca body request mentah (file biner) jadi Buffer. Vercel otomatis mengurai
// JSON ke req.body, tapi untuk Content-Type lain (mis. application/pdf)
// req.body kosong dan byte-nya ada di stream req -- dipegang keduanya.
async function bacaBodyMentah(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'binary');
  const chunks = [];
  try {
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  } catch (e) { /* stream sudah habis dibaca framework */ }
  return Buffer.concat(chunks);
}

// Konteks auto-fill untuk form edit sumur: nilai yang sebaiknya diambil dari
// data yang SUDAH ada di web, supaya admin tidak mengetik ulang:
//   statis/dinamis -> pembacaan terbaru sumur_level_readings untuk sumur ini
//   jenisPompa     -> kolom `type` baris terbaru kpi_9_7_items instalasi ini
// Dipakai sebagai "saran" awal di form; admin tetap boleh mengubahnya.
async function autoFillSumur(sumurId, installation) {
  const auto = { statis: null, dinamis: null, jenisPompa: null };
  if (!installation || !sumurId) return auto;
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (well_name) well_name, statis, dinamis
       FROM sumur_level_readings
       WHERE installation = $1 AND (statis IS NOT NULL OR dinamis IS NOT NULL)
       ORDER BY well_name, bulan DESC`,
      [installation]
    );
    const cocok = rows.find(r => wellIdFromName(installation, r.well_name) === sumurId);
    if (cocok) {
      if (cocok.statis !== null && cocok.statis !== undefined) auto.statis = String(cocok.statis);
      if (cocok.dinamis !== null && cocok.dinamis !== undefined) auto.dinamis = String(cocok.dinamis);
    }
  } catch (e) { /* auto-fill tidak wajib: form tetap bisa diisi manual */ }

  // Jenis pompa dari KPI 9.7 Laporan Kondisi Air Sumur (isian admin terbaru
  // kalau ada, jatuh ke default contoh 9.7). Hanya 5 IPA yang dicakup 9.7.
  // kpi.js dimuat DI SINI (lazy), bukan di top-level file -- lihat komentar
  // di atas. Hanya GET context=1 (buka form edit) yang lewat baris ini.
  const { getK97PumpType } = require('../../lib/visualization/kpi');
  auto.jenisPompa = await getK97PumpType(installation, nomorDariSumurId(sumurId));

  return auto;
}

async function handleSumber(req, res) {
  const user = requireAdmin(req, res);
  if (!user) return;
  await ensureSumberTables();

  // Upload lampiran MENTAH (file biner, bukan base64) ke Vercel Blob.
  // Dipakai file PDF yang lebih besar: base64 menambah ±33% ukuran (file
  // 3,8 MB jadi ~5 MB) dan melewati batas body serverless Vercel (4,5 MB),
  // padahal file mentah 3,8 MB masih muat. Alur: client unggah file dulu di
  // sini -> dapat url/pathname -> baru simpan metadata lewat POST biasa.
  //   POST ?action=sumber&upload=1&jenis=sumur&lampiran=logging|pumping&id=<sumur_id>
  //   Content-Type: application/pdf (atau mime file), body = byte file.
  if (req.query.upload !== undefined) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const jenis = String(req.query.jenis || '');
    const lampiran = String(req.query.lampiran || '');
    const id = String(req.query.id || '');
    if (jenis !== 'sumur' || !['logging', 'pumping'].includes(lampiran) || !id) {
      return res.status(400).json({ error: 'jenis=sumur, lampiran (logging/pumping), dan id wajib diisi' });
    }
    const isi = await bacaBodyMentah(req);
    if (!isi || !isi.length) return res.status(400).json({ error: 'File kosong.' });
    if (isi.length > MAKS_LAMPIRAN) {
      return res.status(413).json({ error: 'File terlalu besar, maksimal 4 MB.' });
    }
    const contentType = String(req.headers['content-type'] || '').split(';')[0] || 'application/octet-stream';
    try {
      const hasil = await put(`sumber/sumur-${lampiran}/${Date.now()}-lampiran`, isi, {
        access: 'public', contentType, addRandomSuffix: true
      });
      return res.status(200).json({ success: true, url: hasil.url, pathname: hasil.pathname });
    } catch (err) {
      return res.status(500).json({
        error: process.env.BLOB_READ_WRITE_TOKEN
          ? 'Gagal mengunggah file ke penyimpanan: ' + err.message
          : 'Penyimpanan file belum aktif. Buat Blob Store di dashboard Vercel dulu.'
      });
    }
  }

  if (req.method === 'GET') {
    const jenis = req.query.jenis;
    const id = String(req.query.id || '');
    if (jenis === 'sumur' && id) {
      const { rows } = await pool.query(`SELECT * FROM sumber_sumur WHERE sumur_id = $1`, [id]);
      const detail = rows[0] || null;
      const auto = req.query.context !== undefined
        ? await autoFillSumur(id, detail ? detail.installation : installationDariSumurId(id))
        : {};
      return res.status(200).json({ detail, auto });
    }
    if (jenis === 'waduk' && id) {
      const { rows } = await pool.query(`SELECT * FROM sumber_waduk WHERE waduk_id = $1`, [id]);
      return res.status(200).json({ detail: rows[0] || null });
    }
    return res.status(400).json({ error: 'jenis (waduk/sumur) dan id wajib diisi' });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    const admin = user.username || 'admin';

    if (b.jenis === 'waduk') {
      const id = teksSumber(b.waduk_id);
      const nama = teksSumber(b.nama);
      if (!id || !nama) return res.status(400).json({ error: 'id dan nama wajib diisi' });

      let fotoUrl = teksSumber(b.foto_url) || null;
      let fotoPath = teksSumber(b.foto_pathname) || null;
      // Urutan dicek dataUrl dulu: kalau ada file baru, itu yang menang
      // (hapus flag cuma berlaku kalau TIDAK ada file pengganti).
      if (b.foto_dataUrl) {
        const unggah = await unggahLampiran(b.foto_dataUrl, 'waduk');
        if (unggah && unggah.error) return res.status(400).json({ error: unggah.error });
        await hapusBlobSumber(fotoPath);
        fotoUrl = unggah ? unggah.url : null;
        fotoPath = unggah ? unggah.pathname : null;
      } else if (b.hapusFoto) {
        await hapusBlobSumber(fotoPath);
        fotoUrl = null; fotoPath = null;
      }

      await pool.query(
        `INSERT INTO sumber_waduk
           (waduk_id, nama, luas, kapasitas, limpasan, foto_url, foto_pathname,
            keterangan, urutan, created_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),$10, now())
         ON CONFLICT (waduk_id) DO UPDATE SET
           nama = EXCLUDED.nama, luas = EXCLUDED.luas, kapasitas = EXCLUDED.kapasitas,
           limpasan = EXCLUDED.limpasan, foto_url = EXCLUDED.foto_url,
           foto_pathname = EXCLUDED.foto_pathname, keterangan = EXCLUDED.keterangan,
           urutan = EXCLUDED.urutan, updated_at = now()`,
        [id, nama, teksSumber(b.luas), teksSumber(b.kapasitas), teksSumber(b.limpasan),
         fotoUrl, fotoPath, teksSumber(b.keterangan), toNumOrNull(b.urutan), admin]
      );
      return res.status(200).json({ success: true });
    }

    if (b.jenis === 'sumur') {
      const id = teksSumber(b.sumur_id);
      const installation = teksSumber(b.installation);
      const nama = teksSumber(b.nama);
      if (!id || !installation || !nama) {
        return res.status(400).json({ error: 'id, installation, dan nama wajib diisi' });
      }

      // Lampiran: upload baru (data URL) menggantikan yang lama, atau hapus.
      let loggingUrl = teksSumber(b.lampiran_logging_url) || null;
      let loggingPath = teksSumber(b.lampiran_logging_pathname) || null;
      if (b.lampiranLogging_dataUrl) {
        const unggah = await unggahLampiran(b.lampiranLogging_dataUrl, 'sumur-logging');
        if (unggah && unggah.error) return res.status(400).json({ error: unggah.error });
        await hapusBlobSumber(loggingPath);
        loggingUrl = unggah ? unggah.url : null;
        loggingPath = unggah ? unggah.pathname : null;
      } else if (b.hapusLogging) {
        await hapusBlobSumber(loggingPath);
        loggingUrl = null; loggingPath = null;
      }

      let pumpingUrl = teksSumber(b.lampiran_pumping_url) || null;
      let pumpingPath = teksSumber(b.lampiran_pumping_pathname) || null;
      if (b.lampiranPumping_dataUrl) {
        const unggah = await unggahLampiran(b.lampiranPumping_dataUrl, 'sumur-pumping');
        if (unggah && unggah.error) return res.status(400).json({ error: unggah.error });
        await hapusBlobSumber(pumpingPath);
        pumpingUrl = unggah ? unggah.url : null;
        pumpingPath = unggah ? unggah.pathname : null;
      } else if (b.hapusPumping) {
        await hapusBlobSumber(pumpingPath);
        pumpingUrl = null; pumpingPath = null;
      }

      await pool.query(
        `INSERT INTO sumber_sumur
           (sumur_id, installation, nama, tahun_dibuat, pipa_hisap, kedalaman,
            panjang_pipa, statis, dinamis, jenis_pompa,
            lampiran_logging_url, lampiran_logging_pathname,
            lampiran_pumping_url, lampiran_pumping_pathname,
            keterangan, urutan, created_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 COALESCE($16,0),$17, now())
         ON CONFLICT (sumur_id) DO UPDATE SET
           installation = EXCLUDED.installation, nama = EXCLUDED.nama,
           tahun_dibuat = EXCLUDED.tahun_dibuat, pipa_hisap = EXCLUDED.pipa_hisap,
           kedalaman = EXCLUDED.kedalaman, panjang_pipa = EXCLUDED.panjang_pipa,
           statis = EXCLUDED.statis, dinamis = EXCLUDED.dinamis,
           jenis_pompa = EXCLUDED.jenis_pompa,
           lampiran_logging_url = EXCLUDED.lampiran_logging_url,
           lampiran_logging_pathname = EXCLUDED.lampiran_logging_pathname,
           lampiran_pumping_url = EXCLUDED.lampiran_pumping_url,
           lampiran_pumping_pathname = EXCLUDED.lampiran_pumping_pathname,
           keterangan = EXCLUDED.keterangan, urutan = EXCLUDED.urutan,
           updated_at = now()`,
        [id, installation, nama, teksSumber(b.tahun_dibuat), teksSumber(b.pipa_hisap),
         teksSumber(b.kedalaman), teksSumber(b.panjang_pipa), teksSumber(b.statis),
         teksSumber(b.dinamis), teksSumber(b.jenis_pompa),
         loggingUrl, loggingPath, pumpingUrl, pumpingPath,
         teksSumber(b.keterangan), toNumOrNull(b.urutan), admin]
      );
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'jenis (waduk/sumur) wajib diisi' });
  }

  if (req.method === 'DELETE') {
    const jenis = req.query.jenis;
    const id = String(req.query.id || '');
    if (!id || !jenis) return res.status(400).json({ error: 'jenis dan id wajib diisi' });
    if (jenis === 'waduk') {
      const { rows } = await pool.query(`DELETE FROM sumber_waduk WHERE waduk_id = $1 RETURNING foto_pathname`, [id]);
      if (rows.length) await hapusBlobSumber(rows[0].foto_pathname);
    } else if (jenis === 'sumur') {
      const { rows } = await pool.query(
        `DELETE FROM sumber_sumur WHERE sumur_id = $1 RETURNING lampiran_logging_pathname, lampiran_pumping_pathname`, [id]
      );
      if (rows.length) {
        await hapusBlobSumber(rows[0].lampiran_logging_pathname);
        await hapusBlobSumber(rows[0].lampiran_pumping_pathname);
      }
    } else {
      return res.status(400).json({ error: 'jenis harus waduk atau sumur' });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// --- action=peta: CRUD titik peta (admin). Dipakai apps/peta-ipa-sumur waktu
// admin menambah titik baru atau mengoreksi koordinat titik yang sudah ada.
//
// Menghapus di sini TIDAK selalu berarti titiknya hilang: kalau id-nya ada di
// data/lokasi.json, titik itu kembali ke koordinat aslinya. Klien yang tahu
// bedanya (dia punya lokasi.json), jadi tombolnya yang diberi label berbeda.
const JENIS_PETA = ['ipa', 'sumur', 'waduk'];

// Batas koordinat dipakai sebagai validasi, bukan sekadar angka: lat & lng
// yang tertukar saat mengetik (-1,2 jadi 1,2 dst) hasilnya masih "angka
// valid" tapi markernya nyasar. Rentangnya yang membatasi -- di Balikpapan
// lat selalu negatif dan lng selalu ~116-117.
function koordinatValid(v, batas) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= batas ? n : null;
}

async function handlePeta(req, res) {
  const user = requireAdmin(req, res);
  if (!user) return;
  await ensurePetaTables();
  const admin = user.username || 'admin';

  // GET dipakai form edit untuk membaca keterangan/created_by yang tidak
  // ikut dikirim lewat endpoint publik map-lokasi.
  if (req.method === 'GET') {
    const { rows } = await pool.query(`SELECT * FROM peta_lokasi ORDER BY jenis, nama`);
    return res.status(200).json({ rows: rows.map(r => Object.assign({}, r)) });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    const jenis = teksSumber(b.jenis);
    let id = teksSumber(b.lokasi_id);
    const nama = teksSumber(b.nama);
    const lat = koordinatValid(b.lat, 90);
    const lng = koordinatValid(b.lng, 180);

    if (!JENIS_PETA.includes(jenis)) {
      return res.status(400).json({ error: 'jenis harus ipa, sumur, atau waduk' });
    }
    if (!id || !nama) return res.status(400).json({ error: 'lokasi_id dan nama wajib diisi' });
    if (lat === null || lng === null) {
      return res.status(400).json({ error: 'Koordinat tidak valid (lat -90..90, lng -180..180).' });
    }

    // installation cuma bermakna untuk sumur: dipakai peta untuk mengelompokkan
    // sumur per IPA induk di dropdown navigasi.
    let installation = jenis === 'sumur' ? teksSumber(b.installation) : null;

    // --- Sumur: rapikan id, lalu daftarkan sumurnya -------------------------
    // Id sumur TIDAK dipercaya apa adanya. Halaman peta menyarankan
    // "{instalasi}_{NN}", tapi field-nya bisa diketik bebas, dan id yang salah
    // format bikin sumur itu tidak akan pernah dapat data debit/statis/dinamis
    // -- penggabungan di klien memakai wellIdFromName() yang selalu 2 digit.
    // Id juga yang MENENTUKAN instalasi (bukan field instalasi di form), jadi
    // titik mustahil berpindah instalasi diam-diam.
    let nomorSumur = null;
    let namaKolom = null;
    let idLamaDirapikan = null;   // koreksi baris lama yang id-nya belum kanonik
    if (jenis === 'sumur') {
      if (!installation) {
        return res.status(400).json({ error: 'Instalasi induk wajib dipilih untuk sumur' });
      }
      await ensureSumberTables();   // detail sumber ikut dipindah kalau id dirapikan

      const rapi = normalisasiIdSumur(id, installation);
      if (!rapi.ok) return res.status(400).json({ error: rapi.error });

      // Id yang dikirim belum kanonik ('teritip_1'). Ada DUA kemungkinan, dan
      // membedakannya penting -- kalau tidak, salah satunya berujung titik dobel:
      //
      //   a. Baris dengan id itu SUDAH ada -> ini koreksi titik lama yang id-nya
      //      belum 2 digit. Baris itu harus DIPINDAH ke id yang rapi, bukan
      //      ditambah baris baru. Kalau cuma di-upsert dengan id baru, upsertnya
      //      tidak menemukan konflik (kuncinya beda) dan justru menyisipkan
      //      baris kedua -- sumur yang sama jadi dua titik di peta.
      //   b. Baris itu TIDAK ada -> ini titik baru. Kalau id rapi tujuannya
      //      sudah dipakai, artinya menabrak sumur lain: tolak, karena upsert
      //      akan menimpa koordinat & nama sumur itu diam-diam.
      //
      // Kalau id yang dikirim sudah rapi, tidak ada yang perlu dipindah: itu
      // baris itu sendiri.
      if (rapi.berubah) {
        const { rows: barisLama } = await pool.query(
          `SELECT lokasi_id FROM peta_lokasi WHERE jenis = 'sumur' AND lokasi_id = $1`,
          [id]
        );
        const { rows: barisTujuan } = await pool.query(
          `SELECT lokasi_id FROM peta_lokasi WHERE jenis = 'sumur' AND lokasi_id = $1`,
          [rapi.id]
        );

        if (barisLama.length && barisTujuan.length) {
          // Dua-duanya ada: baris lama belum kanonik DAN id tujuannya sudah
          // dipakai baris lain. Tidak bisa diputuskan otomatis -- salah pilih
          // berarti menimpa sumur yang salah.
          return res.status(400).json({
            error: `Peta punya dua titik untuk sumur ini: ${id} dan ${rapi.id}. `
              + `Periksa keduanya di peta, hapus yang salah, baru simpan lagi.`
          });
        }
        if (barisTujuan.length) {
          return res.status(400).json({
            error: `Sumur ${rapi.id} sudah ada di peta. Kalau mau memindahkan titik sumur itu, `
              + `buka titiknya dari peta (bukan lewat "Tambah titik"). Kalau ini memang sumur lain, pakai nomor lain.`
          });
        }
        if (barisLama.length) idLamaDirapikan = id;
      }

      id = rapi.id;
      nomorSumur = rapi.nomor;
      namaKolom = teksSumber(b.namaKolom);
    }

    // Titik peta & pendaftaran sumurnya satu transaksi: kalau pendaftaran
    // sumurnya gagal (mis. nama kolom bentrok), titiknya jangan terlanjur
    // tersimpan -- kalau tidak, peta dan daftar sumur balik tidak sinkron,
    // persis masalah yang mau dihilangkan.
    const client = await pool.connect();
    let hasilSumur = null;
    try {
      await client.query('BEGIN');

      // Baris lama yang id-nya belum 2 digit dipindah dulu, BARU di-upsert di
      // bawah -- supaya upsertnya ketemu konflik di baris yang sama, bukan
      // menyisipkan baris kedua untuk sumur yang sama.
      if (idLamaDirapikan) {
        await client.query(
          `UPDATE peta_lokasi SET lokasi_id = $1, updated_at = now()
           WHERE jenis = 'sumur' AND lokasi_id = $2`,
          [id, idLamaDirapikan]
        );
        // Detail sumber di-key oleh sumur_id yang memakai id titik peta (lihat
        // lib/db.js), jadi barisnya harus ikut pindah -- kalau tidak, detailnya
        // menggantung di id lama dan tampak hilang dari Daftar Sumber Air Baku.
        await client.query(
          `UPDATE sumber_sumur SET sumur_id = $1, updated_at = now()
           WHERE sumur_id = $2`,
          [id, idLamaDirapikan]
        );
      }

      await client.query(
        `INSERT INTO peta_lokasi
           (jenis, lokasi_id, nama, installation, lat, lng, keterangan, created_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (jenis, lokasi_id) DO UPDATE SET
           nama = EXCLUDED.nama, installation = EXCLUDED.installation,
           lat = EXCLUDED.lat, lng = EXCLUDED.lng,
           keterangan = EXCLUDED.keterangan, updated_at = now()`,
        [jenis, id, nama, installation, lat, lng, teksSumber(b.keterangan), admin]
      );

      if (jenis === 'sumur') {
        hasilSumur = await pastikanSumurTerdaftar(client, installation, { nomor: nomorSumur, namaKolom });
        if (!hasilSumur.ok) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: hasilSumur.error });
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // lokasi_id ikut dibalas supaya klien tahu id yang BENAR-BENAR tersimpan
    // (bisa beda dari yang diketik: 'teritip_1' -> 'teritip_01').
    return res.status(200).json({
      success: true,
      lokasi_id: id,
      installation: installation,
      well_name: hasilSumur ? hasilSumur.wellName : null,
      sumurDibuat: hasilSumur ? hasilSumur.dibuat : false
    });
  }

  if (req.method === 'DELETE') {
    const jenis = String(req.query.jenis || '');
    const id = String(req.query.id || '');
    if (!JENIS_PETA.includes(jenis) || !id) {
      return res.status(400).json({ error: 'jenis (ipa/sumur/waduk) dan id wajib diisi' });
    }

    // Sumur: titik baru yang dilepas sekalian disingkirkan dari daftar sumur,
    // tapi HANYA kalau memang belum pernah diisi data.
    //
    // Dua penjaga, dan dua-duanya perlu:
    //   1. Titik BAWAAN (ada di data/lokasi.json) tidak pernah menghapus sumur.
    //      DELETE di situ bukan penghapusan -- itu "kembalikan ke koordinat
    //      asli", dan sumurnya jelas masih ada. Dibaca dari berkas, bukan dari
    //      flag kiriman klien: ini penentu data boleh hilang atau tidak, jadi
    //      tidak pantas bergantung pada apa yang dikirim browser.
    //   2. Sumur yang sudah punya pembacaan di sumur_debit_readings
    //      DIPERTAHANKAN. sumur_wells itu satu-satunya penentu kolom di halaman
    //      input; kalau barisnya dihapus, data debitnya jadi menggantung dan
    //      tidak bisa dibuka lagi dari web -- kelihatannya seperti data hilang.
    let sumurDihapus = false;
    let sumurDipertahankan = false;

    if (jenis === 'sumur') {
      const bawaan = (LOKASI_BAWAAN.sumur || []).some(s => s.id === id);
      if (!bawaan) {
        const installation = installationDariId(id);
        const nomor = nomorDariId(id);
        const { rows: kandidat } = await pool.query(
          `SELECT well_name FROM sumur_wells WHERE installation = $1 AND category = 'debit'`,
          [installation]
        );
        // nomor HARUS ada: tanpa penjaga ini, id tanpa nomor (nomor = null)
        // akan cocok dengan nama kolom yang juga tidak berpola sumur -- dua-duanya
        // null, dan sumur yang salah ikut terhapus.
        const cocok = nomor === null ? null : kandidat.find(r => nomorDariWellName(r.well_name) === nomor);

        if (cocok) {
          const { rows: adaData } = await pool.query(
            `SELECT 1 FROM sumur_debit_readings WHERE installation = $1 AND well_name = $2 LIMIT 1`,
            [installation, cocok.well_name]
          );
          if (adaData.length) {
            sumurDipertahankan = true;
          } else {
            await pool.query(
              `DELETE FROM sumur_wells WHERE installation = $1 AND category = 'debit' AND well_name = $2`,
              [installation, cocok.well_name]
            );
            sumurDihapus = true;
          }
        }
      }
    }

    await pool.query(`DELETE FROM peta_lokasi WHERE jenis = $1 AND lokasi_id = $2`, [jenis, id]);
    return res.status(200).json({ success: true, sumurDihapus, sumurDipertahankan });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = async (req, res) => {
  await ensureVizTables();

  const { action } = req.query;

  // Publik, tanpa admin -- dipakai apps/peta-ipa-sumur (sama seperti
  // api/home-summary.js yang juga publik). Harus dicek SEBELUM requireAdmin.
  if (action === 'map-latest') return handleMapLatest(req, res);
  if (action === 'map-lokasi') return handleMapLokasi(req, res);

  const user = requireAdmin(req, res);
  if (!user) return;

  if (action === 'daily') return handleDaily(req, res);
  if (action === 'daily-history') return handleDailyHistory(req, res);
  if (action === 'sumur') return handleSumur(req, res);
  if (action === 'sumur-history') return handleSumurHistory(req, res);
  if (action === 'bulk') return handleBulk(req, res);
  if (action === 'wells') return handleWells(req, res);
  if (action === 'signers') return handleSigners(req, res);
  if (action === 'spd') return handleSpd(req, res);
  if (action === 'lpj') return handleLpj(req, res);
  if (action === 'sumber') return handleSumber(req, res);
  if (action === 'peta') return handlePeta(req, res);

  return res.status(400).json({ error: 'action wajib diisi (daily/daily-history/sumur/sumur-history/bulk/wells/signers/spd/lpj/sumber/peta/map-latest/map-lokasi)' });
};
