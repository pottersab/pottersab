const { pool, ensureTable } = require('../_db');
const { requireAdmin } = require('../_auth');

module.exports = async (req, res) => {
  await ensureTable();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = requireAdmin(req, res);
  if (!user) return;

  const { rows } = await pool.query('SELECT * FROM history ORDER BY created_at DESC');

  let csv = 'ID,Tipe Dokumen,Nama Dokumen,Pembuat,Role,Tanggal\n';
  rows.forEach(r => {
    const tanggal = new Date(r.created_at).toLocaleString('id-ID');
    csv += `${r.id},"${r.document_type}","${r.document_name}","${r.created_by}","${r.role}","${tanggal}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=history.csv');
  return res.status(200).send(csv);
};
