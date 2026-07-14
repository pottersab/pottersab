const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../auth');
const { pool } = require('../db');

function extractToken(req) {
  const authHeader = req.headers['authorization'] || '';
  const headerToken = authHeader.split(' ')[1];
  if (headerToken) return headerToken;
  if (req.query && req.query.token) return req.query.token;
  return null;
}

// Akses data asli diberikan kalau token adalah JWT admin situs (role admin,
// dari login.html/localStorage yang sudah ada) ATAU token viz-access hasil
// approve email yang masih berlaku. Site-wide: begitu SATU permintaan
// disetujui admin (dari halaman/grup mana pun), tokennya berlaku untuk
// SEMUA data viewer di apps/riwayat-air-baku maupun apps/library -- tidak
// lagi dicocokkan ke data_type/grup yang diminta di permintaan awal (itu
// cuma konteks buat admin, bukan pembatas akses).
//
// Tetap dicek ulang ke DB (bukan cuma percaya masa berlaku JWT-nya sendiri)
// supaya konsisten dengan token_expires_at & status approved yang sebenarnya
// (mis. kalau suatu saat ada fitur revoke).
//
// PENTING: fungsi ini KHUSUS untuk akses data viewer, dan sengaja terpisah
// dari requireAdmin/getUserFromRequest di lib/auth.js. Token viz-access
// tidak pernah punya field `role`, jadi tidak akan pernah lolos requireAdmin
// -- endpoint admin-only (admin-input.js, admin-library.js, dst.) tidak
// boleh dan tidak pernah memanggil checkVizAccess.
async function checkVizAccess(req) {
  const token = extractToken(req);
  if (!token) return { granted: false };

  let payload;
  try {
    payload = jwt.verify(token, SECRET_KEY);
  } catch (err) {
    return { granted: false };
  }

  if (payload.role === 'admin') {
    return { granted: true, kind: 'admin' };
  }

  if (payload.scope === 'viz-access' && payload.requestId) {
    const { rows } = await pool.query(
      'SELECT status, token_expires_at FROM access_requests WHERE id = $1',
      [payload.requestId]
    );
    const request = rows[0];
    if (!request || request.status !== 'approved') return { granted: false };
    if (!request.token_expires_at || new Date(request.token_expires_at).getTime() <= Date.now()) {
      return { granted: false };
    }
    return { granted: true, kind: 'viz', requestId: payload.requestId };
  }

  return { granted: false };
}

module.exports = { checkVizAccess };
