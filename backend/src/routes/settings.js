const express = require('express');
const { getDb, updateDb } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Logo and Maps key are shown on the login screen too, so this doesn't
// require auth — only branding + a client-side Maps key live here, never
// the WhatsApp/SMS provider keys (those stay behind requireRole('admin') below).
router.get('/public', (req, res) => {
  const s = getDb().appSettings;
  res.json({ logoDataUrl: s.logoDataUrl || '', mapsApiKey: s.mapsApiKey || '' });
});

// Full settings, including WhatsApp/SMS provider keys, admin only.
router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ settings: getDb().appSettings });
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { mapsApiKey, whatsappOtpKey, smsApiKey, otherKeys, logoDataUrl } = req.body || {};
  const patch = {};
  if (mapsApiKey !== undefined) patch.mapsApiKey = mapsApiKey;
  if (whatsappOtpKey !== undefined) patch.whatsappOtpKey = whatsappOtpKey;
  if (smsApiKey !== undefined) patch.smsApiKey = smsApiKey;
  if (Array.isArray(otherKeys)) patch.otherKeys = otherKeys;
  if (logoDataUrl !== undefined) patch.logoDataUrl = logoDataUrl;

  await updateDb((d) => {
    d.appSettings = Object.assign({}, d.appSettings, patch);
  });
  res.json({ settings: getDb().appSettings });
});

module.exports = router;
