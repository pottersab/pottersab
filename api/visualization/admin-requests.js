const { pool, ensureVizTables } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');

// Admin-only. Dua mode (digabung 1 file supaya tidak menambah jumlah
// Serverless Functions):
//   GET /api/visualization/admin-requests
//     -> daftar access_requests (tanpa approve_secret/token -- sensitif,
//        tidak perlu ditampilkan ke UI admin), terbaru dulu.
//   GET /api/visualization/admin-requests?requestId=123
//     -> daftar access_logs milik request itu (riwayat lihat/unduh data
//        oleh viewer yang di-approve), terbaru dulu.
module.exports = async (req, res) => {
  await ensureVizTables();

  const user = requireAdmin(req, res);
  if (!user) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { requestId } = req.query;

  if (requestId) {
    const { rows } = await pool.query(
      `SELECT id, data_type, action, created_at
       FROM access_logs WHERE request_id = $1
       ORDER BY created_at DESC LIMIT 500`,
      [requestId]
    );
    return res.status(200).json({ logs: rows });
  }

  const { rows } = await pool.query(
    `SELECT id, requested_by, data_type, reason, status, created_at, approved_at, token_expires_at
     FROM access_requests ORDER BY created_at DESC LIMIT 200`
  );
  return res.status(200).json({ requests: rows });
};
