// Minimal JSON-file database.
//
// SomoExpress's interim volumes don't need a full database server — this
// keeps the whole backend installable with nothing but Node.js. If the
// business outgrows this (heavy concurrent writes, need for real
// transactions/reporting), swap this module out for Postgres/SQLite; every
// route file only talks to the functions exported here, so that's a
// contained change.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const DEFAULT_DB = {
  accounts: {},
  riders: {},
  deliveries: {},
  pricingParams: { base: 10, rate: 6, minFare: 25, minPct: 85, opsPhone: '' },
  appSettings: { mapsApiKey: '', whatsappOtpKey: '', smsApiKey: '', otherKeys: [], logoDataUrl: '' },
};

function ensureDbFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
  }
}

ensureDbFile();

let cache = null;
function loadFromDisk() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    cache = JSON.parse(raw);
  } catch (e) {
    cache = JSON.parse(JSON.stringify(DEFAULT_DB));
  }
  // fill in any keys added to the schema after this file was first created
  for (const key of Object.keys(DEFAULT_DB)) {
    if (!(key in cache)) cache[key] = DEFAULT_DB[key];
  }
  return cache;
}
loadFromDisk();

// Serialize writes so two near-simultaneous requests can't corrupt the file.
let writeChain = Promise.resolve();
function persist() {
  writeChain = writeChain.then(
    () =>
      new Promise((resolve, reject) => {
        fs.writeFile(DB_PATH, JSON.stringify(cache, null, 2), (err) => {
          if (err) reject(err);
          else resolve();
        });
      })
  );
  return writeChain;
}

/** Read the whole in-memory database (already parsed). */
function getDb() {
  return cache;
}

/** Mutate the database via a callback, then persist to disk. */
async function updateDb(mutator) {
  mutator(cache);
  await persist();
  return cache;
}

module.exports = { getDb, updateDb, DB_PATH };
