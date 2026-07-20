const { pool, ensureVizTables } = require('../../lib/db');
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
      const setClause = info.cols.map(c => `${c} = NULL`).join(', ');
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

module.exports = async (req, res) => {
  await ensureVizTables();

  const user = requireAdmin(req, res);
  if (!user) return;

  const { action } = req.query;
  if (action === 'daily') return handleDaily(req, res);
  if (action === 'daily-history') return handleDailyHistory(req, res);
  if (action === 'sumur') return handleSumur(req, res);
  if (action === 'wells') return handleWells(req, res);

  return res.status(400).json({ error: 'action wajib diisi (daily/daily-history/sumur/wells)' });
};
