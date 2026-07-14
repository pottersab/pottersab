const { pool, ensureVizTables } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await ensureVizTables();

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'id wajib diisi' });
  }

  const { rows } = await pool.query(
    'SELECT status, token, token_expires_at FROM access_requests WHERE id = $1',
    [id]
  );
  const request = rows[0];

  if (!request) {
    return res.status(404).json({ status: 'not_found' });
  }

  if (request.status !== 'approved') {
    return res.status(200).json({ status: 'pending' });
  }

  const expiresAt = request.token_expires_at ? new Date(request.token_expires_at) : null;
  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    return res.status(200).json({ status: 'expired' });
  }

  return res.status(200).json({ status: 'approved', token: request.token, expiresAt: expiresAt.toISOString() });
};
