const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { pool, ensureVizTables } = require('../../lib/db');
const { isValidAccessGroup, ACCESS_GROUP_LABELS } = require('../../lib/visualization/columns');

function getBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await ensureVizTables();

  const { requestedBy, dataType, reason } = req.body || {};

  if (!requestedBy || !String(requestedBy).trim()) {
    return res.status(400).json({ error: 'Nama wajib diisi' });
  }
  if (!dataType || !isValidAccessGroup(dataType)) {
    return res.status(400).json({ error: 'dataType (grup akses) wajib diisi dan harus dikenal' });
  }

  const approveSecret = crypto.randomBytes(24).toString('hex');

  const { rows } = await pool.query(
    `INSERT INTO access_requests (requested_by, data_type, reason, status, approve_secret)
     VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
    [String(requestedBy).trim(), dataType, reason || null, approveSecret]
  );
  const requestId = rows[0].id;

  const approveUrl = `${getBaseUrl(req)}/api/visualization/approve?id=${requestId}&secret=${approveSecret}`;
  const dataTypeLabel = ACCESS_GROUP_LABELS[dataType];

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    await transporter.sendMail({
      from: `"Portal PTMB" <${process.env.GMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `Permintaan Akses Data — ${requestedBy}`,
      html: `
        <p>Ada permintaan akses data vital di Portal PTMB:</p>
        <ul>
          <li><b>Nama:</b> ${escapeHtml(requestedBy)}</li>
          <li><b>Diminta dari halaman:</b> ${escapeHtml(dataTypeLabel)}</li>
          <li><b>Alasan:</b> ${reason ? escapeHtml(reason) : '(tidak diisi)'}</li>
        </ul>
        <p style="color:#B5502E;"><b>Catatan:</b> menyetujui permintaan ini akan membuka akses SEMUA data &amp; contoh isi surat di seluruh portal (Data Pengambilan Air Baku, Data Waduk dan Sumur, Generator SPD, Berita Acara, dan Surat Permohonan) untuk peminta ini, bukan cuma dari halaman di atas.</p>
        <p>Klik tombol di bawah untuk menyetujui (berlaku 1 jam sejak disetujui):</p>
        <p><a href="${approveUrl}" style="display:inline-block;background:#0B5566;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Setujui Akses</a></p>
        <p style="color:#888;font-size:12px;">Kalau tombol tidak berfungsi, salin tautan ini: ${approveUrl}</p>
      `
    });
  } catch (err) {
    console.error('Gagal mengirim email permintaan akses:', err);
    return res.status(500).json({ error: 'Permintaan tersimpan tapi gagal mengirim notifikasi email ke admin. Coba lagi nanti.' });
  }

  return res.status(200).json({ success: true, requestId });
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
