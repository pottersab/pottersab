const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../_auth');
const { pool } = require('../_db');

function extractToken(req) {
  const authHeader = req.headers['authorization'] || '';
  const headerToken = authHeader.split(' ')[1];
  if (headerToken) return headerToken;
  if (req.query && req.query.token) return req.query.token;
  return null;
}

// Akses data asli diberikan kalau token adalah JWT admin situs (role admin,
// dari login.html/localStorage yang sudah ada) ATAU token viz-access hasil
// approve email yang masih berlaku (dicek ulang ke DB supaya konsisten
// dengan token_expires_at, bukan cuma percaya masa berlaku JWT-nya sendiri).
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
