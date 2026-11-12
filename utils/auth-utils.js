/* ========================================
   DERMAMIND - Auth Utilities
   ======================================== */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Checked lazily (not at module load) so a deployment that hasn't set
// JWT_SECRET yet can still boot and serve the pre-existing OTP/notification
// endpoints; it only fails the moment an auth/profile route is actually hit.
function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('JWT_SECRET is not set. Add a long random JWT_SECRET to your .env before using login/signup.');
  }
  return secret;
}

function newId() {
  return crypto.randomUUID();
}

async function hashPassword(plainPassword) {
  const saltRounds = 12;
  return bcrypt.hash(plainPassword, saltRounds);
}

async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, requireJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, requireJwtSecret()); // throws if invalid/expired
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return EMAIL_REGEX.test(String(email || '').trim());
}

module.exports = { newId, hashPassword, verifyPassword, signToken, verifyToken, isValidEmail };
