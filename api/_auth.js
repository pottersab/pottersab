const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET;

function getUserFromRequest(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.split(' ')[1];
  if (!token) return null;

  try {
    return jwt.verify(token, SECRET_KEY);
  } catch (err) {
    return null;
  }
}

// Kirim response 401/403 kalau tidak valid. Return null kalau gagal (sudah dikirim response),
// atau objek user kalau berhasil.
function requireAuth(req, res) {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Token tidak valid atau tidak ada' });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Khusus admin' });
    return null;
  }
  return user;
}

module.exports = { SECRET_KEY, getUserFromRequest, requireAuth, requireAdmin };
