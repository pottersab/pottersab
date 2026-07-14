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

    let query = 'SELECT * FROM history WHERE 1=1';
    const params = [];

    if (type) {
      params.push(type);
      query += ` AND document_type = $${params.length}`;
    }
    if (startDate) {
      params.push(startDate);
      query += ` AND created_at >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      query += ` AND created_at <= $${params.length}::date + interval '1 day'`;
    }

    query += ' ORDER BY created_at DESC LIMIT 1000';

    const { rows } = await pool.query(query, params);

    const data = rows.map(r => ({
      id: Number(r.id),
      documentType: r.document_type,
      documentName: r.document_name,
      details: r.details,
      createdBy: r.created_by,
      role: r.role,
      createdAt: r.created_at
    }));

    return res.status(200).json({ success: true, data });
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

    const { id } = req.query;
    await pool.query('DELETE FROM history WHERE id = $1', [id]);

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
