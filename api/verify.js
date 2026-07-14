const { getUserFromRequest } = require('../lib/auth');

module.exports = async (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ valid: false });
  }
  return res.status(200).json({ valid: true, user });
};
