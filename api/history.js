const { pool, ensureTable } = require('../lib/db');
const { getUserFromRequest, requireAdmin } = require('../lib/auth');

// Digabung dari history.js + history/[id].js (DELETE) + history/export.js
// (CSV) supaya jumlah file di api/ tetap di bawah batas 12 Serverless
// Functions di Vercel Hobby plan. DELETE pakai ?id=, export CSV pakai
// ?export=1 -- logic masing-masing tidak berubah dari file aslinya.
module.exports = async (req, res) => {
  await ensureTable();

  if (req.method === 'GET') {
    const user = requireAdmin(req, res);
    if (!user) return;

    if (req.query.export !== undefined) {
      const { rows } = await pool.query('SELECT * FROM history ORDER BY created_at DESC');

      let csv = 'ID,Tipe Dokumen,Nama Dokumen,Pembuat,Role,Tanggal\n';
      rows.forEach(r => {
        const tanggal = new Date(r.created_at).toLocaleString('id-ID');
        csv += `${r.id},"${r.document_type}","${r.document_name}","${r.created_by}","${r.role}","${tanggal}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=history.csv');
      return res.status(200).send(csv);
    }

    const { type, startDate, endDate } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (type) {
      params.push(type);
      whereClause += ` AND document_type = $${params.length}`;
    }
    if (startDate) {
      params.push(startDate);
      whereClause += ` AND created_at >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      whereClause += ` AND created_at <= $${params.length}::date + interval '1 day'`;
    }

    // Hitung total/admin/guest yang cocok filter yang sama (bukan cuma dari
    // baris yang sudah dimuat client) supaya stat card tetap akurat
    // walaupun tabelnya dipaginasi.
    const countQuery = `SELECT
        COUNT(*) FILTER (WHERE role = 'admin') AS admin_count,
        COUNT(*) FILTER (WHERE role = 'guest') AS guest_count,
        COUNT(*) AS total_count
       FROM history ${whereClause}`;
    const dataQuery = `SELECT * FROM history ${whereClause}
       ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const [{ rows: countRows }, { rows: dataRows }] = await Promise.all([
      pool.query(countQuery, params),
      pool.query(dataQuery, [...params, limit, offset])
    ]);

    const data = dataRows.map(r => ({
      id: Number(r.id),
      documentType: r.document_type,
      documentName: r.document_name,
      details: r.details,
      createdBy: r.created_by,
      role: r.role,
      createdAt: r.created_at
    }));

    const s = countRows[0];
    return res.status(200).json({
      success: true,
      data,
      hasMore: dataRows.length === limit,
      stats: { total: Number(s.total_count), admin: Number(s.admin_count), guest: Number(s.guest_count) }
    });
  }

  if (req.method === 'POST') {
    // Guest tidak perlu login untuk tercatat di history.
    // Kalau ada token admin yang valid, dicatat sebagai admin. Kalau tidak, dicatat sebagai guest/tamu.
    const user = getUserFromRequest(req);

    const { documentType, documentName, details } = req.body || {};

    if (!documentType || !documentName) {
      return res.status(400).json({ error: 'documentType dan documentName wajib diisi' });
    }

    const id = Date.now();
    const createdBy = user ? (user.username || 'Admin') : 'Tamu';
    const role = user ? user.role : 'guest';

    await pool.query(
      `INSERT INTO history (id, document_type, document_name, details, created_by, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, documentType, documentName, details ? JSON.stringify(details) : null, createdBy, role]
    );

    return res.status(200).json({
      success: true,
      entry: { id, documentType, documentName, details, createdBy, role, createdAt: new Date().toISOString() }
    });
  }

  if (req.method === 'DELETE') {
    const user = requireAdmin(req, res);
    if (!user) return;

    // ?ids=1,2,3 (bulk) tetap kompatibel dengan ?id=1 (satuan, dipakai kode lama).
    const idsParam = req.query.ids || req.query.id;
    if (!idsParam) return res.status(400).json({ error: 'ids wajib diisi' });
    const ids = String(idsParam).split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return res.status(400).json({ error: 'ids tidak valid' });

    await pool.query('DELETE FROM history WHERE id = ANY($1::bigint[])', [ids]);

    return res.status(200).json({ success: true, deleted: ids.length });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
