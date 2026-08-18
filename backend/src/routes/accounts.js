const express = require('express');
const { getDb, updateDb } = require('../db');
const { hashPassword, genTempPassword } = require('../auth');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

function publicAccount(acc) {
  return {
    username: acc.username,
    role: acc.role,
    companyName: acc.companyName,
    phone: acc.phone,
    active: acc.active !== false,
    createdAt: acc.createdAt,
  };
}

router.get('/', (req, res) => {
  const db = getDb();
  res.json({ accounts: Object.values(db.accounts).map(publicAccount) });
});

router.post('/', async (req, res) => {
  const { username, phone, password, role, companyName } = req.body || {};
  if (!username || !phone) return res.status(400).json({ error: 'Username and phone number are required.' });
  if (!['admin', 'ops', 'merchant'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (role === 'merchant' && !companyName) return res.status(400).json({ error: 'Merchant accounts need a company name.' });

  const db = getDb();
  if (db.accounts[username.toLowerCase()]) {
    return res.status(400).json({ error: 'That username already exists.' });
  }
  const finalPassword = password || genTempPassword();
  const passwordHash = await hashPassword(finalPassword);
  const account = {
    username,
    phone,
    passwordHash,
    role,
    companyName: role === 'merchant' ? companyName : username,
    active: true,
    createdAt: new Date().toISOString(),
  };
  await updateDb((d) => {
    d.accounts[username.toLowerCase()] = account;
  });
  // Plaintext password is only ever returned this one time, to the admin who
  // set it, so it can be handed to the account holder.
  res.json({ account: publicAccount(account), password: finalPassword });
});

router.patch('/:username', async (req, res) => {
  const key = req.params.username.toLowerCase();
  const db = getDb();
  const account = db.accounts[key];
  if (!account) return res.status(404).json({ error: 'Account not found.' });

  const { active, resetPassword } = req.body || {};
  let newPassword = null;

  if (typeof active === 'boolean') {
    if (account.username.toLowerCase() === req.user.username.toLowerCase() && active === false) {
      return res.status(400).json({ error: "You can't deactivate your own account." });
    }
  }
  if (resetPassword) {
    newPassword = genTempPassword();
  }

  await updateDb((d) => {
    if (typeof active === 'boolean') d.accounts[key].active = active;
  });
  if (newPassword) {
    const passwordHash = await hashPassword(newPassword);
    await updateDb((d) => {
      d.accounts[key].passwordHash = passwordHash;
    });
  }

  res.json({ account: publicAccount(getDb().accounts[key]), password: newPassword || undefined });
});

module.exports = router;
