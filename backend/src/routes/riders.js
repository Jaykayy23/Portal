const express = require('express');
const crypto = require('crypto');
const { getDb, updateDb } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'ops'));

router.get('/', (req, res) => {
  const db = getDb();
  res.json({ riders: Object.values(db.riders) });
});

router.post('/', async (req, res) => {
  const { name, phone, regNumber, model } = req.body || {};
  if (!name || !phone || !regNumber || !model) {
    return res.status(400).json({ error: 'Name, phone, registration number and model are all required.' });
  }
  const id = 'r_' + crypto.randomUUID();
  const rider = { id, name, phone, regNumber, model, status: 'Available' };
  await updateDb((d) => {
    d.riders[id] = rider;
  });
  res.json({ rider });
});

router.patch('/:id', async (req, res) => {
  const db = getDb();
  if (!db.riders[req.params.id]) return res.status(404).json({ error: 'Rider not found.' });
  const { status } = req.body || {};
  await updateDb((d) => {
    if (status) d.riders[req.params.id].status = status;
  });
  res.json({ rider: getDb().riders[req.params.id] });
});

module.exports = router;
