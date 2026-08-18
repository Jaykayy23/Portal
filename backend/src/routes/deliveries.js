const express = require('express');
const crypto = require('crypto');
const { getDb, updateDb } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { calcPrice } = require('../pricing');

const router = express.Router();
router.use(requireAuth);

function isOpsOrAdmin(user) {
  return user.role === 'admin' || user.role === 'ops';
}

function findMerchantPhone(db, companyName) {
  if (!companyName) return '';
  const match = Object.values(db.accounts).find(
    (a) => a.role === 'merchant' && (a.companyName || '').trim().toLowerCase() === companyName.trim().toLowerCase()
  );
  return match ? match.phone : '';
}

// GET /api/deliveries — merchants see only their own; ops/admin see everything,
// each row enriched with the merchant's phone for the Notify action.
router.get('/', (req, res) => {
  const db = getDb();
  let records = Object.values(db.deliveries).sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!isOpsOrAdmin(req.user)) {
    const mine = req.user.companyName.trim().toLowerCase();
    records = records.filter((r) => (r.customer || '').trim().toLowerCase() === mine);
  } else {
    records = records.map((r) => ({ ...r, merchantPhone: findMerchantPhone(db, r.customer) }));
  }
  res.json({ deliveries: records });
});

// POST /api/deliveries — create a request. Price is calculated server-side
// from the current pricing parameters so a client can't submit a fabricated
// recommended/minimum price.
router.post('/', async (req, res) => {
  const { pickup, dropoff, distance, type, surcharges, declaredValue, agreed, customer } = req.body || {};
  if (!pickup || !dropoff || !distance) {
    return res.status(400).json({ error: 'Pickup, drop-off and distance are required.' });
  }
  if (!declaredValue || Number(declaredValue) <= 0) {
    return res.status(400).json({ error: 'Declared value of the item is required.' });
  }

  const db = getDb();
  const finalCustomer = req.user.role === 'merchant' ? req.user.companyName : (customer || req.user.companyName);
  const { recommended, minimum } = calcPrice(db.pricingParams, distance, surcharges || []);
  const finalAgreed = agreed !== undefined && agreed !== null && agreed !== '' ? Number(agreed) : recommended;
  const requiresApproval = finalAgreed < minimum;

  const id = 'd_' + crypto.randomUUID();
  const record = {
    id,
    date: new Date().toISOString(),
    customer: finalCustomer,
    submittedBy: req.user.username,
    pickup,
    dropoff,
    distance: Number(distance),
    type: type || 'Standard',
    surcharges: Array.isArray(surcharges) ? surcharges : [],
    declaredValue: Number(declaredValue),
    recommended,
    minimum,
    agreed: finalAgreed,
    status: requiresApproval ? 'Requires approval' : 'Requested',
    riderId: '',
    riderName: '',
    riderPhone: '',
    riderReg: '',
    riderModel: '',
  };
  await updateDb((d) => {
    d.deliveries[id] = record;
  });
  res.json({ delivery: record });
});

// PATCH /api/deliveries/:id — status changes and rider assignment, ops/admin only.
router.patch('/:id', requireRole('admin', 'ops'), async (req, res) => {
  const db = getDb();
  const existing = db.deliveries[req.params.id];
  if (!existing) return res.status(404).json({ error: 'Delivery not found.' });

  const { status, riderId } = req.body || {};
  const patch = {};

  if (status) patch.status = status;

  if (riderId !== undefined) {
    if (riderId === '' || riderId === null) {
      patch.riderId = '';
      patch.riderName = '';
      patch.riderPhone = '';
      patch.riderReg = '';
      patch.riderModel = '';
    } else {
      const rider = db.riders[riderId];
      if (!rider) return res.status(400).json({ error: 'Unknown rider.' });
      patch.riderId = rider.id;
      patch.riderName = rider.name;
      patch.riderPhone = rider.phone;
      patch.riderReg = rider.regNumber;
      patch.riderModel = rider.model;
      if (existing.status === 'Requested') patch.status = 'Assigned';
    }
  }

  await updateDb((d) => {
    Object.assign(d.deliveries[req.params.id], patch);
  });
  const updated = getDb().deliveries[req.params.id];
  res.json({ delivery: { ...updated, merchantPhone: findMerchantPhone(getDb(), updated.customer) } });
});

module.exports = router;
