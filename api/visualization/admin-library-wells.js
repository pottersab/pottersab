const { pool, ensureVizTables } = require('../_db');
const { requireAdmin } = require('../_auth');

// CRUD daftar sumur aktif per instalasi (dulu di localStorage per-browser di
// input-data-historis.html, sekarang terpusat di Postgres supaya konsisten
// dilihat semua admin). Hapus sumur dari daftar TIDAK menghapus data historis
// yang sudah tersimpan di sumur_*_readings -- cuma tidak muncul lagi di form
// input & tampilan baru.
module.exports = async (req, res) => {
  await ensureVizTables();

  const user = requireAdmin(req, res);
  if (!user) return;

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
};
