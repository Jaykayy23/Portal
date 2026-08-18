const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

if (!process.env.JWT_SECRET) {
  console.warn(
    '[somoexpress] WARNING: JWT_SECRET is not set in .env — using an insecure ' +
      'development default. Set a real secret before deploying this anywhere ' +
      'reachable by other people.'
  );
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
function genTempPassword() {
  return (
    Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6)
  );
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, genTempPassword };
