// JSON-file database.
//
// Same storage format and same read/write surface as the original Express
// backend, so `data/db.json` is portable between the two. Everything else in
// the app talks only to getDb()/updateDb() — swapping this module for
// Postgres/SQLite stays a contained change.
//
// Difference from the Express version: reads always hit the disk instead of a
// long-lived in-memory cache. Next.js can run several worker processes (and
// reloads modules on every edit in dev), so a per-module cache would go stale
// the moment a second process wrote to the file. A file read per request is
// cheap at this volume and removes that whole class of bug.
//
// This still assumes ONE machine with a real filesystem. It is not safe on a
// multi-instance or serverless deploy (e.g. Vercel) where instances have
// separate disks — see README for that case.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Database } from './types';

export const DB_PATH = process.env.SOMO_DB_PATH
  ? path.resolve(process.env.SOMO_DB_PATH)
  : path.join(process.cwd(), 'data', 'db.json');

export const DEFAULT_DB: Database = {
  accounts: {},
  riders: {},
  deliveries: {},
  pricingParams: { base: 10, rate: 6, minFare: 25, minPct: 85, opsPhone: '' },
  appSettings: {
    mapsApiKey: '',
    whatsappOtpKey: '',
    smsApiKey: '',
    otherKeys: [],
    logoDataUrl: '',
  },
};

function freshDefaults(): Database {
  return JSON.parse(JSON.stringify(DEFAULT_DB)) as Database;
}

function ensureDbFile(): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(freshDefaults(), null, 2));
  }
}

function readFromDisk(): Database {
  ensureDbFile();
  let parsed: Partial<Database>;
  try {
    parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) as Partial<Database>;
  } catch {
    // Unreadable or corrupt file: fall back to defaults rather than crashing
    // every request. The bad file is left alone so it can be inspected.
    return freshDefaults();
  }
  // Fill in any keys added to the schema after this file was first written.
  const defaults = freshDefaults();
  return { ...defaults, ...parsed } as Database;
}

/**
 * Writes are serialized through a chain kept on globalThis, so it survives
 * Next.js module reloads in dev and two near-simultaneous requests in the same
 * process can't interleave a read-modify-write.
 */
const globalForDb = globalThis as unknown as { __somoWriteChain?: Promise<unknown> };
globalForDb.__somoWriteChain ??= Promise.resolve();

async function writeAtomic(db: Database): Promise<void> {
  // Write to a temp file and rename, so a crash mid-write can't truncate the
  // real database file.
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
  await fsp.rename(tmp, DB_PATH);
}

/** Read the whole database. Always reflects what is currently on disk. */
export function getDb(): Database {
  return readFromDisk();
}

/**
 * Mutate the database and persist it. The mutator receives freshly-read state,
 * so it never operates on a stale snapshot. Whatever the mutator returns is
 * returned to the caller — handy for reading back the record you just wrote.
 */
export async function updateDb<T>(mutator: (db: Database) => T): Promise<T> {
  const run = async (): Promise<T> => {
    const db = readFromDisk();
    const result = mutator(db);
    await writeAtomic(db);
    return result;
  };
  // Queue behind any in-flight write, and keep the chain alive on failure.
  const queued = globalForDb.__somoWriteChain!.then(run, run);
  globalForDb.__somoWriteChain = queued.catch(() => undefined);
  return queued;
}
