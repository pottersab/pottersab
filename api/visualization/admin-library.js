const { pool, ensureVizTables, ensureSignersTable, ensureSpdTables, ensureTable: ensureHistoryTable } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const { DATASETS } = require('../../lib/visualization/columns');
const { fetchSumurWells } = require('../../lib/visualization/repo');

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

module.exports = async (req, res) => {
  await ensureVizTables();

  const { action } = req.query;

  // Publik, tanpa admin -- dipakai apps/peta-ipa-sumur (sama seperti
  // api/home-summary.js yang juga publik). Harus dicek SEBELUM requireAdmin.
  if (action === 'map-latest') return handleMapLatest(req, res);

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

  return res.status(400).json({ error: 'action wajib diisi (daily/daily-history/sumur/sumur-history/bulk/wells/signers/spd/lpj/map-latest)' });
};
