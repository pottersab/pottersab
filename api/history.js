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

    // Filter tanggal dipisah dari filter tipe supaya bisa dipakai ulang untuk
    // query "byType" di bawah (chip klasifikasi tetap tampil lengkap per
    // jenis surat, cuma mengikuti rentang tanggal -- tidak ikut menyempit
    // kalau salah satu chip/tipe lagi dipilih).
    let dateOnlyClause = 'WHERE 1=1';
    const dateParams = [];
    if (startDate) {
      dateParams.push(startDate);
      dateOnlyClause += ` AND created_at >= $${dateParams.length}`;
    }
    if (endDate) {
      dateParams.push(endDate);
      dateOnlyClause += ` AND created_at <= $${dateParams.length}::date + interval '1 day'`;
    }

    whereClause = dateOnlyClause;
    params.push(...dateParams);
    if (type) {
      params.push(type);
      whereClause += ` AND document_type = $${params.length}`;
    }

    // Hitung total/admin/guest yang cocok filter yang sama (bukan cuma dari
    // baris yang sudah dimuat client) supaya stat card & pagination tetap
    // akurat walaupun tabelnya dipaginasi.
    const countQuery = `SELECT
        COUNT(*) FILTER (WHERE role = 'admin') AS admin_count,
        COUNT(*) FILTER (WHERE role = 'guest') AS guest_count,
        COUNT(*) AS total_count
       FROM history ${whereClause}`;
    const byTypeQuery = `SELECT document_type, COUNT(*) AS n FROM history ${dateOnlyClause} GROUP BY document_type`;
    const dataQuery = `SELECT * FROM history ${whereClause}
       ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const [{ rows: countRows }, { rows: byTypeRows }, { rows: dataRows }] = await Promise.all([
      pool.query(countQuery, params),
      pool.query(byTypeQuery, dateParams),
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

    const byType = {};
    byTypeRows.forEach(r => { byType[r.document_type] = Number(r.n); });

    const s = countRows[0];
    return res.status(200).json({
      success: true,
      data,
      hasMore: dataRows.length === limit,
      stats: { total: Number(s.total_count), admin: Number(s.admin_count), guest: Number(s.guest_count), byType }
    });
  }

  if (req.method === 'POST') {
    // Hanya surat yang dibuat lewat akun admin yang boleh tercatat ke history.
    // Viewer/publik tidak pernah di-INSERT (bukan cuma ditandai 'guest') --
    // tetap balas 200 supaya alur unduh di halaman surat tidak menampilkan
    // error ke user biasa yang memang bukan admin.
    const user = getUserFromRequest(req);
    if (!user || user.role !== 'admin') {
      return res.status(200).json({ success: false, skipped: true });
    }

    const { documentType, documentName, details } = req.body || {};

    if (!documentType || !documentName) {
      return res.status(400).json({ error: 'documentType dan documentName wajib diisi' });
    }

    const id = Date.now();
    const createdBy = user.username || 'Admin';
    const role = 'admin';

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

  if (req.method === 'PUT') {
    const user = requireAdmin(req, res);
    if (!user) return;

    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id wajib diisi' });

    const { documentType, documentName, details } = req.body || {};
    if (!documentType || !documentName) {
      return res.status(400).json({ error: 'documentType dan documentName wajib diisi' });
    }

    const { rows } = await pool.query(
      `UPDATE history SET document_type = $1, document_name = $2, details = $3
       WHERE id = $4 RETURNING id, document_type, document_name, details, created_by, role, created_at`,
      [documentType, documentName, details ? JSON.stringify(details) : null, id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Entri tidak ditemukan' });

    const r = rows[0];
    return res.status(200).json({
      success: true,
      entry: {
        id: Number(r.id),
        documentType: r.document_type,
        documentName: r.document_name,
        details: r.details,
        createdBy: r.created_by,
        role: r.role,
        createdAt: r.created_at
      }
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
