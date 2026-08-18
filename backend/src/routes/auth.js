const express = require('express');
const { getDb, updateDb } = require('../db');
const { hashPassword, verifyPassword, signToken } = require('../auth');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function publicAccount(acc) {
  return {
    username: acc.username,
    role: acc.role,
    companyName: acc.companyName,
    phone: acc.phone,
    active: acc.active !== false,
  };
}

// Tells the frontend whether to show "create admin account" or "log in".
router.get('/bootstrap-status', (req, res) => {
  const db = getDb();
  res.json({ hasAccounts: Object.keys(db.accounts).length > 0 });
});

// First-run only: creates the one and only way in when no accounts exist yet.
router.post('/setup', async (req, res) => {
  const db = getDb();
  if (Object.keys(db.accounts).length > 0) {
    return res.status(400).json({ error: 'Setup has already been completed. Please log in.' });
  }
  const { username, phone, password } = req.body || {};
  if (!username || !phone || !password) {
    return res.status(400).json({ error: 'Username, phone number and password are all required.' });
  }
  const passwordHash = await hashPassword(password);
  const account = {
    username,
    phone,
    passwordHash,
    role: 'admin',
    companyName: username,
    active: true,
    createdAt: new Date().toISOString(),
  };
  await updateDb((d) => {
    d.accounts[username.toLowerCase()] = account;
  });
  const token = signToken({ username: account.username });
  res.json({ token, user: publicAccount(account) });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Enter your username and password.' });
  }
  const db = getDb();
  const account = db.accounts[username.toLowerCase()];
  if (!account || account.active === false) {
    return res.status(401).json({ error: 'No active account with that username.' });
  }
  const ok = await verifyPassword(password, account.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
  const token = signToken({ username: account.username });
  res.json({ token, user: publicAccount(account) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
