const { pool, ensureVizTables } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');

// Admin-only. Tiga mode (digabung 1 file supaya tidak menambah jumlah
// Serverless Functions):
//   GET /api/visualization/admin-requests
//     -> daftar access_requests (tanpa approve_secret/token -- sensitif,
//        tidak perlu ditampilkan ke UI admin), terbaru dulu.
//   GET /api/visualization/admin-requests?requestId=123
//     -> daftar access_logs milik request itu (riwayat lihat/unduh data
//        oleh viewer yang di-approve), terbaru dulu.
//   DELETE /api/visualization/admin-requests?ids=1,2,3
//     -> hapus access_requests terpilih (satuan atau massal) + access_logs
//        miliknya (tidak ada FK, jadi dihapus manual dulu supaya tidak
//        jadi baris yatim).
module.exports = async (req, res) => {
  await ensureVizTables();

  const user = requireAdmin(req, res);
  if (!user) return;

  if (req.method === 'DELETE') {
    const idsParam = req.query.ids;
    if (!idsParam) return res.status(400).json({ error: 'ids wajib diisi' });
    const ids = String(idsParam).split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return res.status(400).json({ error: 'ids tidak valid' });

    await pool.query('DELETE FROM access_logs WHERE request_id = ANY($1::bigint[])', [ids]);
    await pool.query('DELETE FROM access_requests WHERE id = ANY($1::bigint[])', [ids]);

    return res.status(200).json({ success: true, deleted: ids.length });
  }

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

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const { rows } = await pool.query(
    `SELECT id, requested_by, data_type, reason, status, created_at, approved_at, token_expires_at
     FROM access_requests ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return res.status(200).json({ requests: rows, hasMore: rows.length === limit });
};
