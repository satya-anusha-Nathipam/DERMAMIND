/* ========================================
   DERMAMIND - Auth Routes
   POST /auth/signup
   POST /auth/login
   GET  /auth/me
   ======================================== */

const express = require('express');
const db = require('../db/database');
const requireAuth = require('../middleware/require-auth');
const { newId, hashPassword, verifyPassword, signToken, isValidEmail } = require('../utils/auth-utils');

const router = express.Router();

// Wraps an async route handler so a thrown/rejected error reaches Express's
// error middleware instead of crashing the process (Express 4 does not
// catch async errors automatically).
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

router.post('/signup', asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const id = newId();
  const passwordHash = await hashPassword(password);
  const createdAt = new Date().toISOString();

  db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, email, passwordHash, createdAt);

  // Every user gets an (initially empty) patient profile row so later
  // GET/PUT /profile calls don't need to special-case "no row yet".
  db.prepare('INSERT INTO patient_profiles (user_id, emergency_alert_consent, emergency_verified, consent_status, updated_at) VALUES (?, 0, 0, 0, ?)')
    .run(id, createdAt);

  const user = { id, name, email, created_at: createdAt };
  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'Please enter your email and password.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(user) });
}));

module.exports = router;
