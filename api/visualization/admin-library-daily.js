const { pool, ensureVizTables } = require('../_db');
const { requireAdmin } = require('../_auth');
const { DATASETS } = require('./_columns');

// Field pendek (dipakai form admin) -> key dataset di DATASETS. Manggar
// punya 4 field (Teritip tidak punya curah hujan).
const FIELD_MAP = {
  manggar: { level: 'manggar_level', hujan: 'manggar_hujan', ntu: 'manggar_ntu', ph: 'manggar_ph' },
  teritip: { level: 'teritip_level', ntu: 'teritip_ntu', ph: 'teritip_ph' }
};

function toNumOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// Ganti Google Sheets (DAILY_SHEET_MAP di input-data-historis.html lama)
// untuk input harian Waduk Manggar/Teritip (Level, Curah Hujan, Kekeruhan,
// PH), admin-only, langsung ke Postgres.
module.exports = async (req, res) => {
  await ensureVizTables();

  const user = requireAdmin(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const { group, tanggal } = req.query;
    if (!FIELD_MAP[group] || !tanggal) {
      return res.status(400).json({ error: 'group (manggar/teritip) dan tanggal wajib diisi' });
    }
    const values = {};
    for (const [field, key] of Object.entries(FIELD_MAP[group])) {
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
    if (!FIELD_MAP[group] || !tanggal) {
      return res.status(400).json({ error: 'group (manggar/teritip) dan tanggal wajib diisi' });
    }

    // Kelompokkan field yang diisi berdasarkan tabel tujuan -- beberapa
    // field (ntu/ph Manggar & Teritip) berbagi 1 tabel (kualitas_air_manggar_teritip).
    const byTable = {};
    for (const [field, key] of Object.entries(FIELD_MAP[group])) {
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

  return res.status(405).json({ error: 'Method not allowed' });
};
