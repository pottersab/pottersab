const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { SECRET_KEY } = require('../lib/auth');
const { pool, ensureUsersTable } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  await ensureUsersTable();

  const { rows } = await pool.query(
    'SELECT username, password_hash, display_name, avatar_initial, role FROM users WHERE username = $1',
    [username]
  );
  const user = rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ success: false, error: 'Username atau password salah' });
  }

  const token = jwt.sign(
    { username: user.username, role: user.role, displayName: user.display_name, avatarInitial: user.avatar_initial },
    SECRET_KEY,
    { expiresIn: '24h' }
  );

  return res.status(200).json({
    success: true,
    token,
    role: user.role,
    username: user.username,
    displayName: user.display_name,
    avatarInitial: user.avatar_initial
  });
};
