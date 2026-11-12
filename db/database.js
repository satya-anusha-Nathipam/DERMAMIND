/* ========================================
   DERMAMIND - Database Layer (SQLite)
   ========================================
   Single persistent SQLite database for:
     - users               (accounts + password hashes)
     - patient_profiles    (personal + emergency-contact details)
     - analyses            (AI screening history; image storage wired in Phase 3)

   Why SQLite: the app has modest, mostly-per-user read/write volume and no
   existing database was present (everything lived in browser localStorage).
   SQLite gives real persistence and per-user data isolation without
   requiring a separate managed database service. DB_PATH can point to a
   Render persistent disk mount in production.
   ======================================== */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dermamind.db');

// Make sure the containing directory exists (e.g. ./data on first boot).
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age INTEGER,
  sex TEXT,
  dob TEXT,
  blood_group TEXT,
  phone TEXT,
  city TEXT,
  emergency_name TEXT,
  emergency_relationship TEXT,
  emergency_phone TEXT,
  emergency_email TEXT,
  emergency_alert_method TEXT,
  emergency_alert_consent INTEGER NOT NULL DEFAULT 0,
  emergency_verified INTEGER NOT NULL DEFAULT 0,
  emergency_verification_token TEXT,
  emergency_verification_key TEXT,
  language_preference TEXT NOT NULL DEFAULT 'en',
  consent_status INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Schema created now (Phase 2) so Phase 3 (image storage) and later phases
-- don't need a migration. Columns are nullable until those phases wire them up.
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  original_image_path TEXT,
  heatmap_image_path TEXT,
  predicted_class TEXT,
  confidence REAL,
  class_probabilities TEXT,       -- JSON string
  image_quality_status TEXT,      -- 'good' | 'poor' | 'invalid'
  image_validation_message TEXT,
  user_description TEXT,          -- JSON string, user-provided notes
  model_name TEXT,
  model_version TEXT,
  screening_result TEXT,          -- JSON string: { risk, riskClass, explanation }
  disclaimer_acknowledged INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id, created_at DESC);
`);

module.exports = db;
