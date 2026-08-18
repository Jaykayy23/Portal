const { verifyToken } = require('../auth');
const { getDb } = require('../db');

/** Requires a valid Bearer token; attaches req.user = { username, role, companyName, phone }. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const payload = verifyToken(token);
    const db = getDb();
    const account = db.accounts[payload.username.toLowerCase()];
    if (!account || account.active === false) {
      return res.status(401).json({ error: 'Account no longer active.' });
    }
    req.user = {
      username: account.username,
      role: account.role,
      companyName: account.companyName || account.username,
      phone: account.phone,
    };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired or invalid — please log in again.' });
  }
}

/** Requires req.user.role to be one of the given roles. Use after requireAuth. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
