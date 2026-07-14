const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool, ensureVizTables } = require('../../lib/db');
const { SECRET_KEY } = require('../../lib/auth');
const { ACCESS_GROUP_LABELS } = require('../../lib/visualization/columns');

const ONE_HOUR_MS = 60 * 60 * 1000;

function page(title, message, ok) {
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><title>${title}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#EFF5F6;color:#0E2A32;
    display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
  .card{background:#fff;border:1px solid #C7DADD;border-radius:14px;padding:32px 28px;max-width:380px;text-align:center;}
  .icon{font-size:32px;margin-bottom:10px;}
  h1{font-size:17px;margin:0 0 8px;color:${ok ? '#0B5566' : '#C6553D'};}
  p{font-size:13.5px;color:#4C6870;line-height:1.6;margin:0;}
</style></head>
<body><div class="card"><div class="icon">${ok ? '✅' : '⚠️'}</div><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

function safeSecretMatch(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  await ensureVizTables();

  const { id, secret } = req.query;
  if (!id || !secret) {
    return res.status(400).send(page('Tautan tidak lengkap', 'Parameter id atau secret hilang dari tautan.', false));
  }

  const { rows } = await pool.query('SELECT * FROM access_requests WHERE id = $1', [id]);
  const request = rows[0];

  if (!request) {
    return res.status(404).send(page('Permintaan tidak ditemukan', 'Permintaan akses ini tidak ada atau sudah dihapus.', false));
  }
  if (!safeSecretMatch(request.approve_secret, secret)) {
    return res.status(403).send(page('Tautan tidak valid', 'Kode approve tidak cocok.', false));
  }
  if (request.status === 'approved') {
    return res.status(200).send(page('Sudah disetujui', `Permintaan dari ${request.requested_by} sudah disetujui sebelumnya.`, true));
  }

  const token = jwt.sign({ requestId: Number(id), scope: 'viz-access' }, SECRET_KEY, { expiresIn: '1h' });
  const expiresAt = new Date(Date.now() + ONE_HOUR_MS);

  await pool.query(
    `UPDATE access_requests SET status = 'approved', token = $1, token_expires_at = $2, approved_at = now() WHERE id = $3`,
    [token, expiresAt, id]
  );

  const groupLabel = ACCESS_GROUP_LABELS[request.data_type] || request.data_type;
  return res.status(200).send(page(
    'Akses disetujui',
    `Permintaan dari <b>${request.requested_by}</b> (diminta dari halaman <b>${groupLabel}</b>) sudah disetujui. Akses ini berlaku selama 1 jam untuk SEMUA data viewer di kedua halaman (Data Pengambilan Air Baku & Data Waduk dan Sumur), tidak cuma yang diminta. Halaman viewer akan otomatis terbuka dalam beberapa detik.`,
    true
  ));
};
