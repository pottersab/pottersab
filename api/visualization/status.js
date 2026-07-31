const crypto = require('crypto');
const { pool, ensureVizTables } = require('../../lib/db');

// Dipanggil berulang oleh halaman yang sedang menunggu permintaan aksesnya
// disetujui admin. Kalau sudah, token viz-access-nya dikirim balik ke sini.
//
// Karena yang keluar dari endpoint ini adalah TOKEN, pemanggilnya wajib
// membuktikan bahwa dia memang pengirim permintaannya, lewat poll_secret yang
// cuma dikembalikan sekali ke browser peminta oleh api/visualization/request.js.
// Id permintaan sendiri tidak membuktikan apa-apa: bentuknya urut (BIGSERIAL)
// dan gampang ditebak, jadi kalau id saja sudah cukup, siapa pun bisa
// mencacah 1,2,3... dan memungut token orang lain selama masa berlakunya --
// padahal api/visualization/admin-requests.js sengaja tidak pernah
// menampilkan token yang sama itu ke UI admin.
function cocok(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (!bufA.length || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await ensureVizTables();

  const { id, secret } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'id wajib diisi' });
  }

  const { rows } = await pool.query(
    'SELECT status, token, token_expires_at, poll_secret FROM access_requests WHERE id = $1',
    [id]
  );
  const request = rows[0];

  if (!request) {
    return res.status(404).json({ status: 'not_found' });
  }

  // Kunci salah, atau barisnya dari sebelum poll_secret ada: dijawab sama
  // dengan permintaan yang tidak ada, supaya endpoint ini tidak bisa dipakai
  // menebak id mana yang hidup. Halaman peminta sudah menangani 'not_found'
  // dengan membersihkan permintaan yang menggantung, jadi permintaan lama
  // yang belum sempat disetujui berhenti dengan rapi -- tinggal minta ulang.
  if (!cocok(request.poll_secret, secret)) {
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
