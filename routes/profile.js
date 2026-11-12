/* ========================================
   DERMAMIND - Patient Profile Routes
   GET /profile
   PUT /profile
   All routes require a valid session and only ever touch req.userId's own row.
   ======================================== */

const express = require('express');
const db = require('../db/database');
const requireAuth = require('../middleware/require-auth');

const router = express.Router();

// DB column (snake_case) <-> frontend field (camelCase, matches the existing
// localStorage profile shape so script.js needed minimal changes).
function toApiShape(user, profile) {
  return {
    name: user.name,
    phone: profile?.phone || '',
    email: user.email,
    dob: profile?.dob || '',
    gender: profile?.sex || '',
    bloodGroup: profile?.blood_group || '',
    city: profile?.city || '',
    emergencyName: profile?.emergency_name || '',
    emergencyRelationship: profile?.emergency_relationship || '',
    emergencyPhone: profile?.emergency_phone || '',
    emergencyEmail: profile?.emergency_email || '',
    emergencyAlertMethod: profile?.emergency_alert_method || 'sms',
    emergencyAlertConsent: Boolean(profile?.emergency_alert_consent),
    emergencyVerified: Boolean(profile?.emergency_verified),
    emergencyVerificationToken: profile?.emergency_verification_token || '',
    emergencyVerificationKey: profile?.emergency_verification_key || '',
    languagePreference: profile?.language_preference || 'en',
    consentStatus: Boolean(profile?.consent_status),
    updatedAt: profile?.updated_at || null
  };
}

router.get('/', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const profile = db.prepare('SELECT * FROM patient_profiles WHERE user_id = ?').get(req.userId);
  res.json({ profile: toApiShape(user, profile) });
});

router.put('/', requireAuth, (req, res) => {
  const body = req.body || {};
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Keep the users table's name/email in sync if the form changed them,
  // mirroring the pre-existing frontend behaviour.
  const newName = String(body.name || user.name).trim();
  const newEmail = String(body.email || user.email).trim().toLowerCase();
  if (newName !== user.name || newEmail !== user.email) {
    const clash = newEmail !== user.email
      ? db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(newEmail, req.userId)
      : null;
    if (clash) return res.status(409).json({ error: 'Another account already uses that email.' });
    db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(newName, newEmail, req.userId);
  }

  const updatedAt = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM patient_profiles WHERE user_id = ?').get(req.userId);

  const fields = {
    dob: body.dob ?? existing?.dob ?? null,
    sex: body.gender ?? existing?.sex ?? null,
    blood_group: body.bloodGroup ?? existing?.blood_group ?? null,
    phone: body.phone ?? existing?.phone ?? null,
    city: body.city ?? existing?.city ?? null,
    emergency_name: body.emergencyName ?? existing?.emergency_name ?? null,
    emergency_relationship: body.emergencyRelationship ?? existing?.emergency_relationship ?? null,
    emergency_phone: body.emergencyPhone ?? existing?.emergency_phone ?? null,
    emergency_email: body.emergencyEmail ?? existing?.emergency_email ?? null,
    emergency_alert_method: body.emergencyAlertMethod ?? existing?.emergency_alert_method ?? 'sms',
    emergency_alert_consent: body.emergencyAlertConsent !== undefined ? (body.emergencyAlertConsent ? 1 : 0) : (existing?.emergency_alert_consent || 0),
    // Verification proof (token/key/verified) comes from the emergency-OTP flow,
    // which the frontend already validated against the notification server.
    emergency_verified: body.emergencyVerified !== undefined ? (body.emergencyVerified ? 1 : 0) : (existing?.emergency_verified || 0),
    emergency_verification_token: body.emergencyVerificationToken ?? existing?.emergency_verification_token ?? null,
    emergency_verification_key: body.emergencyVerificationKey ?? existing?.emergency_verification_key ?? null,
    language_preference: body.languagePreference ?? existing?.language_preference ?? 'en',
    consent_status: body.consentStatus !== undefined ? (body.consentStatus ? 1 : 0) : (existing?.consent_status || 0)
  };

  if (existing) {
    db.prepare(`
      UPDATE patient_profiles SET
        dob = @dob, sex = @sex, blood_group = @blood_group, phone = @phone, city = @city,
        emergency_name = @emergency_name, emergency_relationship = @emergency_relationship,
        emergency_phone = @emergency_phone, emergency_email = @emergency_email,
        emergency_alert_method = @emergency_alert_method, emergency_alert_consent = @emergency_alert_consent,
        emergency_verified = @emergency_verified, emergency_verification_token = @emergency_verification_token,
        emergency_verification_key = @emergency_verification_key, language_preference = @language_preference,
        consent_status = @consent_status, updated_at = @updated_at
      WHERE user_id = @user_id
    `).run({ ...fields, updated_at: updatedAt, user_id: req.userId });
  } else {
    db.prepare(`
      INSERT INTO patient_profiles
        (user_id, dob, sex, blood_group, phone, city, emergency_name, emergency_relationship,
         emergency_phone, emergency_email, emergency_alert_method, emergency_alert_consent,
         emergency_verified, emergency_verification_token, emergency_verification_key,
         language_preference, consent_status, updated_at)
      VALUES
        (@user_id, @dob, @sex, @blood_group, @phone, @city, @emergency_name, @emergency_relationship,
         @emergency_phone, @emergency_email, @emergency_alert_method, @emergency_alert_consent,
         @emergency_verified, @emergency_verification_token, @emergency_verification_key,
         @language_preference, @consent_status, @updated_at)
    `).run({ ...fields, updated_at: updatedAt, user_id: req.userId });
  }

  const freshUser = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.userId);
  const freshProfile = db.prepare('SELECT * FROM patient_profiles WHERE user_id = ?').get(req.userId);
  res.json({ profile: toApiShape(freshUser, freshProfile) });
});

module.exports = router;
