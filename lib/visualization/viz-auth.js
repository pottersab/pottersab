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
// dari login.html/localStorage yang sudah ada -- admin selalu lolos untuk
// SEMUA grup) ATAU token viz-access hasil approve email yang masih berlaku
// DAN disetujui untuk grup (accessGroup) yang sama dengan yang diminta.
// Dicek ulang ke DB (bukan cuma percaya masa berlaku JWT-nya sendiri) supaya
// konsisten dengan token_expires_at dan data_type yang benar-benar disetujui.
//
// requiredGroup wajib diisi oleh pemanggil (data.js/export-pdf.js) dengan
// accessGroup dataset yang sedang diminta (mis. 'ap', 'manggar',
// 'sumur_debit') -- satu approval hanya membuka grup itu, bukan semua grup.
async function checkVizAccess(req, requiredGroup) {
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
      'SELECT status, data_type, token_expires_at FROM access_requests WHERE id = $1',
      [payload.requestId]
    );
    const request = rows[0];
    if (!request || request.status !== 'approved') return { granted: false };
    if (request.data_type !== requiredGroup) return { granted: false };
    if (!request.token_expires_at || new Date(request.token_expires_at).getTime() <= Date.now()) {
      return { granted: false };
    }
    return { granted: true, kind: 'viz', requestId: payload.requestId };
  }

  return { granted: false };
}

module.exports = { checkVizAccess };
