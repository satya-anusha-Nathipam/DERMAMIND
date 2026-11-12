const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();

// Phase 2: persistent SQLite-backed auth + patient profile API, added
// alongside the pre-existing emergency-OTP/notification endpoints below.
// Nothing in this block touches the OTP/notification logic.
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const analysesRoutes = require('./routes/analyses');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.use('/auth', authRoutes);
app.use('/profile', profileRoutes);
app.use('/analyses', analysesRoutes);

const PORT = Number(process.env.PORT || process.env.NOTIFICATION_PORT || 5050);
const otpStore = new Map();
const verifiedTokens = new Map();

const TWOFACTOR_API_KEY = requireEnv('TWOFACTOR_API_KEY');

function normalizePhone(phone) {
  return String(phone || '').replace(/[^+\d]/g, '');
}

function providerPhone(phone) {
  const normalized = normalizePhone(phone);
  return normalized.startsWith('+') ? normalized : `+${normalized}`;
}

function isE164Phone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function verificationKey({ phone, email, method }) {
  return [normalizePhone(phone), normalizeEmail(email), method].join('|');
}

function otpMessage(code) {
  return `DERMAMIND verification code: ${code}. It expires in 10 minutes. If you did not request this code, ignore this message.`;
}

function requireEnv(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

async function twoFactorRequest(url) {
  const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.Details || data.message || `2Factor HTTP ${response.status}`);
  if (String(data.Status || '').toLowerCase() !== 'success') throw new Error(data.Details || '2Factor rejected the OTP request.');
  return data;
}

async function sendOtpSms(phone) {
  if (!TWOFACTOR_API_KEY) throw new Error('2Factor is not configured. Add TWOFACTOR_API_KEY to .env.');
  const number = providerPhone(phone);
  const url = `https://2factor.in/API/V1/${encodeURIComponent(TWOFACTOR_API_KEY)}/SMS/${encodeURIComponent(number)}/AUTOGEN`;
  const data = await twoFactorRequest(url);
  return { channel: 'sms', id: data.Details || null };
}

async function verifyOtpWithTwoFactor(sessionId, otp) {
  if (!TWOFACTOR_API_KEY) throw new Error('2Factor is not configured. Add TWOFACTOR_API_KEY to .env.');
  if (!sessionId) throw new Error('Missing 2Factor verification session ID. Please request a new OTP.');

  // 2Factor's documented legacy OTP flow uses the session ID returned by
  // AUTOGEN and the OTP entered by the user. The provider returns:
  // { Status: "Success", Details: "OTP Matched" } on a successful match.
  const url = `https://2factor.in/API/V1/${encodeURIComponent(TWOFACTOR_API_KEY)}/SMS/VERIFY/${encodeURIComponent(sessionId)}/${encodeURIComponent(otp)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' }
  });
  const data = await response.json().catch(() => ({}));
  const status = String(data.Status || '').trim().toLowerCase();
  const details = String(data.Details || data.message || '').trim();

  if (!response.ok) {
    throw new Error(details || `2Factor verification HTTP ${response.status}`);
  }

  const matched = /otp\s*matched|verified|successfully\s*verified/i.test(details);
  if (status === 'success' && matched) return true;

  if (/invalid|incorrect|expired|mismatch|not matched/i.test(details)) return false;
  throw new Error(details || '2Factor did not confirm the OTP.');
}

async function sendOtpEmail(email, code) {
  const apiKey = requireEnv('RESEND_API_KEY');
  const from = requireEnv('RESEND_FROM_EMAIL');
  if (!apiKey || !from) throw new Error('Resend email is not configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'DERMAMIND Emergency Contact Verification',
      html: `<p>Your DERMAMIND emergency-contact verification code is <strong style="font-size:24px;letter-spacing:4px">${code}</strong>.</p><p>This code expires in 10 minutes. If you did not request it, ignore this email.</p>`,
      text: otpMessage(code)
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.name || `Resend returned HTTP ${response.status}`);
  return { channel: 'email', id: data.id };
}

function cleanupOtps() {
  const now = Date.now();
  for (const [id, entry] of otpStore) if (entry.expiresAt <= now) otpStore.delete(id);
  for (const [token, entry] of verifiedTokens) if (entry.expiresAt <= now) verifiedTokens.delete(token);
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildSmsBody(payload) {
  const p = payload.patient || {};
  const r = payload.report || {};
  return `DERMAMIND AI ALERT for ${p.name || 'patient'} | Screening: ${r.result || 'Concerning lesion'} | Risk: ${r.risk || 'High/Concerning'} | Confidence: ${r.confidence ?? 'N/A'}% | Time: ${r.timestamp || new Date().toLocaleString()} | NOT a confirmed cancer diagnosis; prompt dermatologist evaluation recommended.`;
}

function buildEmail(payload) {
  const p = payload.patient || {};
  const r = payload.report || {};
  const title = r.result || 'Concerning skin lesion';
  const rows = [
    ['Patient', p.name], ['Patient phone', p.phone], ['Patient email', p.email], ['Date of birth', p.dateOfBirth], ['City', p.city],
    ['AI screening result', title], ['AI confidence', `${r.confidence ?? 'N/A'}%`], ['Malignant-category probability', `${r.malignantProbability ?? 'N/A'}%`],
    ['Benign-category probability', `${r.benignProbability ?? 'N/A'}%`], ['Risk level', r.risk], ['Scan time', r.timestamp], ['Model', r.model]
  ];
  const htmlRows = rows.map(([label, value]) => `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:600">${escapeHtml(label)}</td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(value ?? 'Not provided')}</td></tr>`).join('');
  return {
    subject: `DERMAMIND AI Alert — ${title}`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5"><h2>⚠️ DERMAMIND AI Screening Alert</h2><p>The DERMAMIND screening model flagged a potentially concerning lesion for <strong>${escapeHtml(p.name || 'the patient')}</strong>.</p><table style="border-collapse:collapse;width:100%;max-width:700px">${htmlRows}</table><h3>AI explanation</h3><p>${escapeHtml(r.explanation || '')}</p><p style="margin-top:20px;padding:12px;background:#fff4e5;border-radius:8px"><strong>Important:</strong> This is an AI screening result, not a confirmed diagnosis. A qualified dermatologist must evaluate the lesion.</p></body></html>`,
    text: `DERMAMIND AI Screening Alert\n\nPatient: ${p.name}\nResult: ${title}\nRisk: ${r.risk}\nAI confidence: ${r.confidence}%\nMalignant-category probability: ${r.malignantProbability}%\nScan time: ${r.timestamp}\n\n${r.explanation}\n\nThis is NOT a confirmed cancer diagnosis. Please arrange prompt dermatologist evaluation.`
  };
}

async function sendSms(payload) {
  if (!TWOFACTOR_API_KEY) throw new Error('2Factor is not configured. Add TWOFACTOR_API_KEY to .env.');
  if (!payload.emergencyPhone) throw new Error('Emergency contact phone number is missing.');

  // 2Factor's SMS OTP endpoint is used for verification.
  // Emergency AI alerts can still use the existing email path; SMS alerting can be added
  // separately once a DLT-approved transactional template is configured.
  throw new Error('SMS emergency alerts are not configured; the emergency-contact OTP is supported through 2Factor.');
}

async function sendEmail(payload) {
  const apiKey = requireEnv('RESEND_API_KEY');
  const from = requireEnv('RESEND_FROM_EMAIL');
  if (!apiKey || !from) throw new Error('Resend email is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL to .env.');
  if (!payload.emergencyEmail) throw new Error('Emergency contact email is missing.');
  const email = buildEmail(payload);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [payload.emergencyEmail], subject: email.subject, html: email.html, text: email.text })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.name || `Resend returned HTTP ${response.status}`);
  return { id: data.id, channel: 'email' };
}

app.post('/send-contact-otp', async (req, res) => {
  cleanupOtps();
  const phone = normalizePhone(req.body?.phone);
  const email = normalizeEmail(req.body?.email);
  const method = ['sms', 'email', 'both'].includes(req.body?.method) ? req.body.method : 'sms';

  if (!phone) return res.status(400).json({ error: 'Emergency contact phone number is required.' });
  if (!isE164Phone(phone)) return res.status(400).json({ error: 'Enter the emergency contact phone in international format, for example +919876543210.' });
  if ((method === 'email' || method === 'both') && !email) return res.status(400).json({ error: 'Emergency contact email is required for email verification.' });


  const key = verificationKey({ phone, email, method });
  const now = Date.now();
  for (const entry of otpStore.values()) {
    if (entry.key === key && entry.sentAt > now - 60000) return res.status(429).json({ error: 'Please wait 60 seconds before requesting another code.' });
  }

  let smsResult;
  try {
    smsResult = await sendOtpSms(phone);
  } catch (error) {
    return res.status(502).json({ error: `Could not send OTP to the emergency contact: ${error.message}` });
  }

  const verificationId = smsResult.id;
  if (!verificationId) return res.status(502).json({ error: '2Factor did not return a verification session ID.' });

  otpStore.set(verificationId, { key, phone, sentAt: now, expiresAt: now + 10 * 60 * 1000, attempts: 0 });
  res.json({ sent: true, verificationId, channels: ['sms'], expiresInSeconds: 600, demoMode: false });
});

app.post('/verify-contact-otp', async (req, res) => {
  cleanupOtps();
  const verificationId = String(req.body?.verificationId || '');
  const otp = String(req.body?.otp || '').trim();
  let entry = otpStore.get(verificationId);
  if (!entry) {
    const phone = normalizePhone(req.body?.phone);
    const email = normalizeEmail(req.body?.email);
    const method = ['sms', 'email', 'both'].includes(req.body?.method) ? req.body.method : 'sms';
    if (!phone) return res.status(400).json({ verified: false, error: 'This OTP session is no longer available. Request a new verification code.' });
    entry = { key: verificationKey({ phone, email, method }), phone, sentAt: Date.now(), expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 };
  }
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ verified: false, error: 'Enter the 6-digit verification code.' });

  entry.attempts += 1;
  if (entry.attempts > 5) {
    otpStore.delete(verificationId);
    return res.status(429).json({ verified: false, error: 'Too many incorrect attempts. Request a new code.' });
  }

  try {
    const verified = await verifyOtpWithTwoFactor(verificationId, otp);
    if (!verified) return res.status(400).json({ verified: false, error: 'Incorrect or expired verification code.' });
  } catch (error) {
    return res.status(502).json({ verified: false, error: `Verification failed: ${error.message}` });
  }

  otpStore.delete(verificationId);
  const verificationToken = crypto.randomBytes(32).toString('hex');
  verifiedTokens.set(verificationToken, { key: entry.key, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  res.json({ verified: true, verificationToken, verificationKey: entry.key });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'DERMAMIND emergency notification service', port: PORT, demoMode: false, providers: { twoFactor: Boolean(TWOFACTOR_API_KEY) } });
});

app.get('/provider-status', (_req, res) => {
  res.json({ ok: true, demoMode: false, providers: { twoFactor: Boolean(TWOFACTOR_API_KEY) }, note: 'Real SMS OTP is sent to the emergency contact using 2Factor.' });
});

app.post('/notify-emergency', async (req, res) => {
  cleanupOtps();
  const payload = req.body || {};
  const method = ['sms', 'email', 'both'].includes(payload.method) ? payload.method : 'sms';
  const tokenEntry = verifiedTokens.get(payload.emergencyVerificationToken);
  const expectedKey = verificationKey({ phone: payload.emergencyPhone, email: payload.emergencyEmail, method });
  if (!tokenEntry || tokenEntry.expiresAt <= Date.now() || tokenEntry.key !== expectedKey) {
    return res.status(403).json({ sent: false, error: 'Emergency contact verification is missing or expired. Re-verify the contact before sending alerts.' });
  }

  const channels = method === 'both' ? ['demo-sms', 'demo-email'] : [`demo-${method}`];
  console.log('[DEMO ALERT]', { emergencyName: payload.emergencyName, emergencyPhone: payload.emergencyPhone, method, risk: payload.risk, topClass: payload.topClass });
  res.json({ sent: true, demoMode: true, channels, message: 'Emergency alert simulated successfully for local demonstration.' });
});

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'DERMAMIND notification server', message: 'Use /health or /provider-status.' });
});

// Centralized JSON error handler. Keeps error details out of stack traces
// sent to the client; logs the real error server-side for debugging.
app.use((err, _req, res, _next) => {
  console.error('[SERVER ERROR]', err);
  const message = err?.message?.includes('JWT_SECRET')
    ? 'Server auth is not configured. Set JWT_SECRET in the environment.'
    : 'Something went wrong on the server. Please try again.';
  res.status(500).json({ error: message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`DERMAMIND notification server running on port ${PORT}`);
  console.log(`Auth DB ready (JWT auth ${process.env.JWT_SECRET ? 'configured' : 'NOT configured — set JWT_SECRET'})`);
});
