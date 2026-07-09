const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('./_auth');

const ADMIN_CREDS = {
  username: process.env.ADMIN_USERNAME || 'potter',
  password: process.env.ADMIN_PASSWORD || 'rahasia123'
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  if (username === ADMIN_CREDS.username && password === ADMIN_CREDS.password) {
    const token = jwt.sign({ username, role: 'admin' }, SECRET_KEY, { expiresIn: '24h' });
    return res.status(200).json({ success: true, token, role: 'admin', username });
  }

  return res.status(401).json({ success: false, error: 'Username atau password salah' });
};
