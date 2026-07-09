const { pool, ensureTable } = require('../_db');
const { requireAdmin } = require('../_auth');

module.exports = async (req, res) => {
  await ensureTable();

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = requireAdmin(req, res);
  if (!user) return;

  const { id } = req.query;

  await pool.query('DELETE FROM history WHERE id = $1', [id]);

  return res.status(200).json({ success: true });
};
