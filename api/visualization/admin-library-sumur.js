const { pool, ensureVizTables } = require('../_db');
const { requireAdmin } = require('../_auth');
const { fetchSumurWells } = require('./_repo');

function toNumOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// Ganti Google Sheets untuk input bulanan Sumur Dalam (Debit / Statis-Dinamis),
// admin-only, langsung ke Postgres. installation & category selalu di query
// string (identitas resource), body cuma berisi bulan + values.
module.exports = async (req, res) => {
  await ensureVizTables();

  const user = requireAdmin(req, res);
  if (!user) return;

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
};
