require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./src/routes/auth');
const accountsRoutes = require('./src/routes/accounts');
const ridersRoutes = require('./src/routes/riders');
const deliveriesRoutes = require('./src/routes/deliveries');
const pricingRoutes = require('./src/routes/pricing');
const settingsRoutes = require('./src/routes/settings');

const app = express();
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',') }));
// Logos are stored as base64 data URLs, so allow a generous JSON body size.
app.use(express.json({ limit: '5mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/riders', ridersRoutes);
app.use('/api/deliveries', deliveriesRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/settings', settingsRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the frontend as static files, so a single `npm start` here can run
// the whole app for a local install. For a web-server deployment you can
// instead point Nginx/Apache at ../frontend directly and just run this API
// separately — see the README.
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`SomoExpress backend running on http://localhost:${PORT}`);
});
