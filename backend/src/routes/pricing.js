const express = require('express');
const { getDb, updateDb } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({ params: getDb().pricingParams });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { base, rate, minFare, minPct, opsPhone } = req.body || {};
  const params = {
    base: Number(base) || 0,
    rate: Number(rate) || 0,
    minFare: Number(minFare) || 0,
    minPct: Number(minPct) || 0,
    opsPhone: opsPhone || '',
  };
  await updateDb((d) => {
    d.pricingParams = params;
  });
  res.json({ params });
});

module.exports = router;
