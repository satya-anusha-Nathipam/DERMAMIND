/* ========================================
   DERMAMIND - Professional JavaScript
   ======================================== */

// Check login (fast local check first so there's no page flash; the real
// source of truth is the server-verified session token checked below).
const loggedUser = localStorage.getItem("loggedUser");
if(!loggedUser || !DermaMindAPI.getToken()){
  window.location.href="home.html";
}

// Confirm the session token is still valid with the server. A token can go
// stale (expired, or the account was removed) even though the local
// "loggedUser" cache still looks fine, so this is a real server check, not
// just decoration.
async function verifyServerSession() {
  try {
    const user = await DermaMindAPI.me();
    localStorage.setItem('loggedUser', JSON.stringify(user));
  } catch (error) {
    if (error.status === 401) {
      DermaMindAPI.clearToken();
      localStorage.removeItem('loggedUser');
      window.location.href = 'home.html';
    }
    // Other errors (e.g. server temporarily unreachable) are non-fatal —
    // the user can keep using the app with the cached profile/session.
  }
}
verifyServerSession();

// Prevent a dashboard flash before the mandatory Personal Details gate is applied.
document.documentElement.classList.add('profile-gate-pending');

// Real in-browser skin-lesion model (Transformers.js + ONNX).
// The model is fine-tuned on HAM10000 and predicts 7 lesion categories.
// It is a screening/research model, NOT a clinical diagnostic device.
const SKIN_MODEL_ID = "sazio/skin-mole-vit-onnx";
const CHATBOT_SIMULATION_MODE = true;
// Notification server. Keep provider secrets on the server, never in this file.
// Reuses the single DERMAMIND_API_URL constant defined in api-client.js
// (loaded before this file), so there's only one place to edit for local
// testing instead of two out-of-sync copies.
const NOTIFICATION_API_URL = DERMAMIND_API_URL;
let skinClassifier = null;
let skinModelPromise = null;

/* ========================================
   MODALS
   ======================================== */

function showTerms() {
  const modal = document.createElement('div');
  modal.id = 'termsModal';
  modal.className = 'modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:white;padding:32px;border-radius:14px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;">
      <h3 style="margin-bottom:16px;">Terms & Conditions</h3>
      <p style="line-height:1.8;"><strong>Educational Purpose Only</strong><br>Dermamind is an AI screening tool. Always consult a dermatologist.</p>
      <button onclick="this.closest('.modal').remove()" style="margin-top:20px;width:100%;">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function showPrivacy() {
  const modal = document.createElement('div');
  modal.id = 'privacyModal';
  modal.className = 'modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:white;padding:32px;border-radius:14px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;">
      <h3 style="margin-bottom:16px;">Privacy Policy</h3>
      <p style="line-height:1.8;"><strong>Your data stays local</strong><br>We don't upload your images. All data is stored on your device.</p>
      <button onclick="this.closest('.modal').remove()" style="margin-top:20px;width:100%;">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
}

// DOM Elements
const preview = document.getElementById("preview");
const imageInput = document.getElementById("imageInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const resultCard = document.getElementById("resultCard");
const analysisPlaceholder = document.getElementById("analysisPlaceholder");
const riskResult = document.getElementById("riskResult");
const confidence = document.getElementById("confidence");
const explanation = document.getElementById("explanation");
const hospitalSection = document.getElementById("hospitalSection");
const hospitalList = document.getElementById("hospitalList");
const historyList = document.getElementById("historyList");
const appointmentForm = document.getElementById("appointmentForm");
const appointmentList = document.getElementById("appointmentList");
const chatMessages = document.getElementById("chatMessages");
const chatText = document.getElementById("chatText");
const sendChat = document.getElementById("sendChat");

let selectedFile;
let lastImageValidation = null; // result of ImageValidation.validateImageForAnalysis()

const imageQualityPanel = document.getElementById('imageQualityPanel');
const qualityBadge = document.getElementById('qualityBadge');
const qualityReasons = document.getElementById('qualityReasons');
const chooseAnotherBtn = document.getElementById('chooseAnotherBtn');

/* ========================================
   IMAGE PREVIEW + VALIDATION (Phase 4)
   ======================================== */

function resetImageSelection() {
  selectedFile = undefined;
  lastImageValidation = null;
  imageInput.value = '';
  preview.classList.remove('visible');
  preview.removeAttribute('src');
  imageQualityPanel.classList.add('hidden');
  chooseAnotherBtn.classList.add('hidden');
  analyzeBtn.disabled = false;
  analyzeBtn.textContent = 'Scan';
}

function renderImageQuality(result) {
  imageQualityPanel.classList.remove('hidden');
  qualityBadge.textContent = { good: 'Good', poor: 'Poor', invalid: 'Invalid' }[result.status] || '—';
  qualityBadge.className = `quality-badge ${result.status}`;
  qualityReasons.innerHTML = '';
  result.reasons.forEach(reason => {
    const li = document.createElement('li');
    li.textContent = reason;
    qualityReasons.appendChild(li);
  });

  if (result.status === 'invalid') {
    chooseAnotherBtn.classList.remove('hidden');
    analyzeBtn.disabled = true;
  } else {
    chooseAnotherBtn.classList.toggle('hidden', result.status !== 'poor');
    analyzeBtn.disabled = false;
  }
}

chooseAnotherBtn.addEventListener('click', resetImageSelection);

imageInput.addEventListener('change', async (e) => {
  selectedFile = e.target.files[0];
  lastImageValidation = null;
  if (!selectedFile) return;

  const objectUrl = URL.createObjectURL(selectedFile);
  preview.src = objectUrl;
  preview.classList.add('visible');

  imageQualityPanel.classList.remove('hidden');
  qualityBadge.textContent = 'Checking…';
  qualityBadge.className = 'quality-badge checking';
  qualityReasons.innerHTML = '';
  chooseAnotherBtn.classList.add('hidden');
  analyzeBtn.disabled = true;

  try {
    const result = await ImageValidation.validateImageForAnalysis(selectedFile);
    // The file may have changed again while validation was running; only
    // apply this result if it's still for the currently-selected file.
    if (selectedFile && imageInput.files[0] === selectedFile) {
      lastImageValidation = result;
      renderImageQuality(result);
    }
  } catch (error) {
    console.error('Image validation failed:', error);
    lastImageValidation = { status: 'good', reasons: [], message: '' }; // fail open on unexpected errors
    imageQualityPanel.classList.add('hidden');
    analyzeBtn.disabled = false;
  }
});

/* ========================================
   NAVIGATION
   ======================================== */

/* ========================================
   LOGOUT
   ======================================== */

function logoutUser() {
  if (!confirm('Are you sure you want to logout?')) return;
  DermaMindAPI.clearToken();
  localStorage.removeItem('loggedUser');
  window.location.href = 'home.html';
}

function applyProfileGate() {
  const complete = isProfileComplete();
  document.documentElement.classList.toggle('profile-gate-pending', !complete);
  document.querySelectorAll('.navBtn').forEach(btn => {
    const isProfile = btn.dataset.section === 'profile';
    btn.disabled = !complete && !isProfile;
    btn.classList.toggle('locked', !complete && !isProfile);
    btn.setAttribute('aria-disabled', String(!complete && !isProfile));
    if (!complete && !isProfile) btn.title = 'Complete Personal Details first';
    else btn.removeAttribute('title');
  });

  // Dashboard shortcut cards and the floating chatbot are also blocked until
  // the mandatory emergency-contact profile is complete.
  document.querySelectorAll('[data-requires-profile="true"]').forEach(el => {
    el.classList.toggle('profile-locked', !complete);
    el.setAttribute('aria-disabled', String(!complete));
  });
  const chatToggle = document.getElementById('chatToggle');
  const chatbot = document.getElementById('chatbot');
  if (chatToggle) {
    chatToggle.disabled = !complete;
    chatToggle.classList.toggle('profile-locked', !complete);
    chatToggle.title = complete ? 'Open Dermamind assistant' : 'Complete Personal Details first';
  }
  if (!complete && chatbot) chatbot.classList.remove('open');
}

function goToSection(sectionId, options = {}) {
  const complete = isProfileComplete();
  if (!complete && sectionId !== 'profile') {
    applyProfileGate();
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('profile')?.classList.add('active');
    document.querySelectorAll('.navBtn').forEach(b => b.classList.toggle('active', b.dataset.section === 'profile'));
    if (!options.silent) {
      alert('Please complete your Personal Details and mandatory Emergency Contact before accessing DERMAMIND.');
      setTimeout(() => document.getElementById('emergencyName')?.focus(), 50);
    }
    return false;
  }

  document.querySelectorAll('.navBtn').forEach(b => b.classList.remove('active'));
  const nav = document.querySelector(`.navBtn[data-section="${sectionId}"]`);
  if (nav) nav.classList.add('active');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(sectionId)?.classList.add('active');
  if (sectionId === 'hospitals') prepareHospitalsSection();
  if (sectionId === 'history') renderHistoryList();
  applyProfileGate();
  return true;
}

document.querySelectorAll('.navBtn').forEach(btn => {
  btn.addEventListener('click', () => goToSection(btn.dataset.section));
});

/* ========================================
   PERSONAL DETAILS / EMERGENCY CONTACT
   ======================================== */

function getLoggedUserObject() {
  try { return JSON.parse(localStorage.getItem('loggedUser') || 'null'); } catch (_) { return null; }
}

function profileStorageKey() {
  const user = getLoggedUserObject();
  return `dermamindProfile_${(user?.email || 'guest').toLowerCase()}`;
}

function getPersonalProfile() {
  try { return JSON.parse(localStorage.getItem(profileStorageKey()) || 'null'); } catch (_) { return null; }
}

function getEmergencyVerificationKey(profile) {
  if (!profile) return '';
  return [profile.emergencyPhone || '', profile.emergencyEmail || '', profile.emergencyAlertMethod || ''].map(v => String(v).trim().toLowerCase()).join('|');
}

function isEmergencyContactVerified(profile = getPersonalProfile()) {
  if (!profile?.emergencyVerified || !profile?.emergencyVerificationToken) return false;
  return profile.emergencyVerificationKey === getEmergencyVerificationKey(profile);
}

function isProfileComplete(profile = getPersonalProfile()) {
  return Boolean(profile?.name && profile?.phone && profile?.email && profile?.emergencyName && profile?.emergencyRelationship && profile?.emergencyPhone && profile?.emergencyAlertMethod && profile?.emergencyAlertConsent && isEmergencyContactVerified(profile));
}

function loadPersonalProfile() {
  const profile = getPersonalProfile();
  const user = getLoggedUserObject();
  const fields = {
    profileName: profile?.name || user?.name || '',
    profilePhone: profile?.phone || '',
    profileEmail: profile?.email || user?.email || '',
    profileDob: profile?.dob || '',
    profileGender: profile?.gender || '',
    profileBloodGroup: profile?.bloodGroup || '',
    profileCity: profile?.city || '',
    emergencyName: profile?.emergencyName || '',
    emergencyRelationship: profile?.emergencyRelationship || '',
    emergencyPhone: profile?.emergencyPhone || '',
    emergencyEmail: profile?.emergencyEmail || '',
    emergencyAlertMethod: profile?.emergencyAlertMethod || 'sms',
    emergencyAlertConsent: Boolean(profile?.emergencyAlertConsent)
  };

  Object.entries(fields).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });

  renderProfileStatus(profile);
}

function renderProfileStatus(profile = getPersonalProfile()) {
  const status = document.getElementById('profileStatus');
  const summary = document.getElementById('profileSummary');
  if (!status) return;

  if (isProfileComplete(profile)) {
    status.textContent = '✓ Completed & Verified';
    status.className = 'profile-status complete';
    if (summary) {
      summary.innerHTML = `
        <div class="profile-summary-item"><span></span><div><small>Patient</small><strong>${escapeHtml(profile.name)}</strong></div></div>
        <div class="profile-summary-item"><span>📞</span><div><small>Phone</small><strong>${escapeHtml(profile.phone)}</strong></div></div>
        <div class="profile-summary-item"><span></span><div><small>Emergency Contact</small><strong>${escapeHtml(profile.emergencyName)} (${escapeHtml(profile.emergencyRelationship)})</strong><em>${escapeHtml(profile.emergencyPhone)}</em></div></div>
      `;
    }
  } else {
    status.textContent = '⚠ Complete required details';
    status.className = 'profile-status incomplete';
    if (summary) {
      const verificationNote = profile && profile.emergencyName && profile.emergencyPhone
        ? (isEmergencyContactVerified(profile) ? 'Emergency contact verified.' : 'Emergency contact must be verified with an OTP before DERMAMIND unlocks.')
        : 'Please complete the required fields, especially your emergency contact.';
      summary.innerHTML = `<p class="profile-missing-note">${verificationNote}<br>Please complete all required details before accessing the DERMAMIND panels.</p>`;
    }
  }
}

function prefillPatientForms() {
  const profile = getPersonalProfile();
  if (!profile) return;
  const mappings = {
    pname: profile.name,
    phone: profile.phone,
    consultationName: profile.name,
    consultationPhone: profile.phone
  };
  Object.entries(mappings).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el && value) el.value = value;
  });
}

function requireCompletedProfile(actionLabel = 'continue') {
  if (isProfileComplete()) return true;
  alert(`Please complete your Personal Details, including the mandatory emergency contact, before you ${actionLabel}.`);
  goToSection('profile');
  document.getElementById('emergencyName')?.focus();
  return false;
}

let pendingEmergencyVerification = null;
let otpBusy = false;
const emergencyOtpStorageKey = () => `${profileStorageKey()}:pendingOtp`;
function getPendingEmergencyVerification() {
  if (pendingEmergencyVerification?.verificationId) return pendingEmergencyVerification;
  try {
    const raw = sessionStorage.getItem(emergencyOtpStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setPendingEmergencyVerification(value) {
  pendingEmergencyVerification = value;
  try {
    if (value) sessionStorage.setItem(emergencyOtpStorageKey(), JSON.stringify(value));
    else sessionStorage.removeItem(emergencyOtpStorageKey());
  } catch {}
}

function currentEmergencyContactData() {
  return {
    phone: document.getElementById('emergencyPhone')?.value.trim() || '',
    email: document.getElementById('emergencyEmail')?.value.trim() || '',
    method: document.getElementById('emergencyAlertMethod')?.value || 'sms'
  };
}

function markEmergencyContactUnverified() {
  const profile = getPersonalProfile();
  if (!profile) return;
  const current = currentEmergencyContactData();
  const currentKey = getEmergencyVerificationKey({ emergencyPhone: current.phone, emergencyEmail: current.email, emergencyAlertMethod: current.method });
  if (profile.emergencyVerificationKey !== currentKey) {
    profile.emergencyVerified = false;
    profile.emergencyVerificationToken = '';
    profile.emergencyVerificationKey = '';
    localStorage.setItem(profileStorageKey(), JSON.stringify(profile));
    renderVerificationStatus(false, 'Contact details changed — verification required again.');
    applyProfileGate();
  }
}

function renderVerificationStatus(verified, message = '') {
  const status = document.getElementById('emergencyVerificationStatus');
  const sendBtn = document.getElementById('sendOtpBtn');
  const verifyBtn = document.getElementById('verifyOtpBtn');
  const saveBtn = document.getElementById('saveProfileBtn');
  if (!status) return;
  status.className = `verification-status ${verified ? 'verified' : 'unverified'}`;
  status.textContent = verified ? 'Contact information verified' : `${message || 'Emergency contact not verified'}`;
  if (sendBtn) sendBtn.disabled = verified || otpBusy;
  if (verifyBtn) verifyBtn.disabled = false;
  // Save stays clickable so the form can always explain what is missing.
}

async function sendEmergencyOtp() {
  const contact = currentEmergencyContactData();
  if (!contact.phone) { alert('Enter the emergency contact phone number first.'); return; }
  if ((contact.method === 'email' || contact.method === 'both') && !contact.email) { alert('Enter the emergency contact email because Email verification is selected.'); return; }
  otpBusy = true;
  renderVerificationStatus(false, 'Sending verification code…');
  try {
    const response = await fetch(`${NOTIFICATION_API_URL}/send-contact-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contact)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    setPendingEmergencyVerification({ verificationId: data.verificationId, ...contact });
    document.getElementById('otpEntryWrap')?.classList.add('visible');
    const channelText = (data.channels || []).join(' + ') || 'verification service';
    renderVerificationStatus(false, `OTP sent to the emergency contact by ${channelText}. Ask them for the 6-digit code and enter it below.`);
    document.getElementById('emergencyOtp')?.focus();
  } catch (error) {
    const message = error?.message || 'Unknown error';
    const friendly = message.includes('Failed to fetch') || message.includes('NetworkError')
      ? 'The notification server is not reachable. Start it with `npm install` then `npm start` from the DERMAMIND project root, and make sure port 5050 is available.'
      : message;
    renderVerificationStatus(false, `Could not send verification code. ${friendly}`);
    alert(`Verification code could not be sent.\n\n${friendly}`);
  } finally {
    otpBusy = false;
    const p = getPersonalProfile();
    if (isEmergencyContactVerified(p)) {
      renderVerificationStatus(true);
    } else if (!getPendingEmergencyVerification()) {
      renderVerificationStatus(false, 'Emergency contact not verified');
    }
  }
}

async function verifyEmergencyOtp() {
  const otp = document.getElementById('emergencyOtp')?.value.trim() || '';
  const pending = getPendingEmergencyVerification();
  if (!pending?.verificationId) { alert('No active verification request was found. Click Send Verification Code and use the newest OTP.'); return; }
  if (!/^\d{6}$/.test(otp)) { alert('Enter the 6-digit verification code.'); return; }
  otpBusy = true;
  renderVerificationStatus(false, 'Verifying code…');
  try {
    const response = await fetch(`${NOTIFICATION_API_URL}/verify-contact-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verificationId: pending.verificationId, otp, phone: pending.phone, email: pending.email, method: pending.method })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.verified !== true) {
      throw new Error(data.error || `The server did not confirm the OTP (HTTP ${response.status}).`);
    }
    const profile = getPersonalProfile() || {};
    profile.emergencyVerified = true;
    profile.emergencyVerificationToken = data.verificationToken;
    profile.emergencyVerificationKey = getEmergencyVerificationKey({ emergencyPhone: pending.phone, emergencyEmail: pending.email, emergencyAlertMethod: pending.method });
    localStorage.setItem(profileStorageKey(), JSON.stringify(profile));
    setPendingEmergencyVerification(null);
    document.getElementById('otpEntryWrap')?.classList.remove('visible');
    document.getElementById('emergencyOtp').value = '';
    renderVerificationStatus(true);
    applyProfileGate();
    alert('Emergency contact information verified successfully. You can now save your Personal Details and access DERMAMIND.');
  } catch (error) {
    renderVerificationStatus(false, error.message || 'Incorrect or expired verification code.');
    alert(`Verification failed. ${error.message || 'Please try again.'}`);
  } finally {
    otpBusy = false;
    const p = getPersonalProfile();
    renderVerificationStatus(isEmergencyContactVerified(p), isEmergencyContactVerified(p) ? '' : 'Emergency contact not verified');
  }
}

document.getElementById('sendOtpBtn')?.addEventListener('click', sendEmergencyOtp);
document.getElementById('verifyOtpBtn')?.addEventListener('click', verifyEmergencyOtp);
['emergencyPhone','emergencyEmail','emergencyAlertMethod'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', markEmergencyContactUnverified);
  document.getElementById(id)?.addEventListener('change', markEmergencyContactUnverified);
});

document.getElementById('personalDetailsForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const profile = {
    name: document.getElementById('profileName').value.trim(),
    phone: document.getElementById('profilePhone').value.trim(),
    email: document.getElementById('profileEmail').value.trim(),
    dob: document.getElementById('profileDob').value,
    gender: document.getElementById('profileGender').value,
    bloodGroup: document.getElementById('profileBloodGroup').value,
    city: document.getElementById('profileCity').value.trim(),
    emergencyName: document.getElementById('emergencyName').value.trim(),
    emergencyRelationship: document.getElementById('emergencyRelationship').value,
    emergencyPhone: document.getElementById('emergencyPhone').value.trim(),
    emergencyEmail: document.getElementById('emergencyEmail').value.trim(),
    emergencyAlertMethod: document.getElementById('emergencyAlertMethod').value,
    emergencyAlertConsent: document.getElementById('emergencyAlertConsent').checked,
    updatedAt: new Date().toISOString()
  };

  // Do our own validation so the save button always gives a useful message.
  if (!profile.name || !profile.phone || !profile.email || !profile.emergencyName || !profile.emergencyRelationship || !profile.emergencyPhone || !profile.emergencyAlertMethod || !profile.emergencyAlertConsent) {
    alert('Please complete all required fields, including the mandatory emergency contact and emergency-alert consent.');
    return;
  }
  if ((profile.emergencyAlertMethod === 'email' || profile.emergencyAlertMethod === 'both') && !profile.emergencyEmail) {
    alert('Please enter the emergency contact email because Email alerts are selected.');
    return;
  }

  const existing = getPersonalProfile() || {};
  const expectedKey = getEmergencyVerificationKey(profile);
  const verifiedSameContact = !!existing.emergencyVerified &&
    !!existing.emergencyVerificationToken &&
    existing.emergencyVerificationKey === expectedKey;

  if (!verifiedSameContact) {
    alert('Please verify the emergency contact with the OTP before saving your profile.');
    renderVerificationStatus(false, 'Emergency contact not verified');
    document.getElementById('sendOtpBtn')?.focus();
    return;
  }

  // Preserve the server-issued verification proof while saving the complete profile.
  profile.emergencyVerified = true;
  profile.emergencyVerificationToken = existing.emergencyVerificationToken;
  profile.emergencyVerificationKey = existing.emergencyVerificationKey;

  const saveBtn = document.getElementById('saveProfileBtn');
  if (saveBtn) saveBtn.disabled = true;

  try {
    // Server (SQLite) is the source of truth; the response is the
    // authoritative saved record.
    const savedProfile = await DermaMindAPI.saveProfile(profile);
    localStorage.setItem(profileStorageKey(), JSON.stringify(savedProfile));

    const user = getLoggedUserObject();
    if (user) {
      user.name = savedProfile.name;
      user.email = savedProfile.email;
      localStorage.setItem('loggedUser', JSON.stringify(user));
    }

    renderProfileStatus(savedProfile);
    prefillPatientForms();
    renderVerificationStatus(true);
    applyProfileGate();
    alert('Personal details saved successfully. DERMAMIND is now unlocked.');
    goToSection('dashboard', { silent: true });
  } catch (error) {
    alert(`Could not save your details to the server. ${error.message || 'Please try again.'}`);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
});

try {
  const savedPending = getPendingEmergencyVerification();
  if (savedPending?.verificationId) {
    pendingEmergencyVerification = savedPending;
    document.getElementById('otpEntryWrap')?.classList.add('visible');
  }
} catch {}

document.getElementById('emergencyOtp')?.addEventListener('input', () => {
  const p = getPersonalProfile();
  if (!isEmergencyContactVerified(p) && getPendingEmergencyVerification()?.verificationId) {
    renderVerificationStatus(false, 'OTP received. Enter the 6-digit code and click Verify Contact.');
  }
});

// The DERMAMIND server (SQLite) is now the source of truth for the patient
// profile. Local functions like getPersonalProfile() stay synchronous and
// read a localStorage cache under profileStorageKey(), so this fetches the
// real record once on load and refreshes that cache + the UI.
async function syncProfileFromServer() {
  try {
    const serverProfile = await DermaMindAPI.getProfile();
    localStorage.setItem(profileStorageKey(), JSON.stringify(serverProfile));
    loadPersonalProfile();
    const p = getPersonalProfile();
    renderVerificationStatus(isEmergencyContactVerified(p), isEmergencyContactVerified(p) ? '' : 'Emergency contact not verified');
    prefillPatientForms();
    applyProfileGate();
    if (!isProfileComplete(p)) {
      goToSection('profile', { silent: true });
    }
  } catch (error) {
    console.error('Could not load profile from server:', error);
  }
}

loadPersonalProfile();
{ const p = getPersonalProfile(); renderVerificationStatus(isEmergencyContactVerified(p), isEmergencyContactVerified(p) ? '' : 'Emergency contact not verified'); }
prefillPatientForms();
applyProfileGate();

// First-time/incomplete users are taken to Personal Details immediately.
// This runs first against the local cache to avoid a flash, then again
// (above, in syncProfileFromServer) once the authoritative server copy loads.
if (!isProfileComplete()) {
  setTimeout(() => goToSection('profile', { silent: true }), 50);
}

syncProfileFromServer();

/* ========================================
   REAL AI SKIN-LESION MODEL
   ======================================== */

const LESION_LABELS = {
  akiec: { name: 'Actinic Keratosis', malignant: true },
  bcc:   { name: 'Basal Cell Carcinoma', malignant: true },
  bkl:   { name: 'Benign Keratosis', malignant: false },
  df:    { name: 'Dermatofibroma', malignant: false },
  mel:   { name: 'Melanoma', malignant: true },
  nv:    { name: 'Melanocytic Nevus', malignant: false },
  vasc:  { name: 'Vascular Lesion', malignant: false }
};

function setModelStatus(message, state = '') {
  const el = document.getElementById('modelStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `model-status ${state}`.trim();
}

async function getSkinClassifier() {
  if (skinClassifier) return skinClassifier;
  if (skinModelPromise) return skinModelPromise;

  skinModelPromise = (async () => {
    setModelStatus('Loading AI model for the first scan…', 'loading');
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.1');
    const classifier = await pipeline('image-classification', SKIN_MODEL_ID, {
      device: 'wasm',
      dtype: 'q8'
    });
    skinClassifier = classifier;
    setModelStatus('AI model ready • running privately in your browser', 'ready');
    return classifier;
  })().catch(error => {
    skinModelPromise = null;
    setModelStatus('AI model could not be loaded. Check your internet connection and try again.', 'error');
    throw error;
  });

  return skinModelPromise;
}

function normalizeModelLabel(label) {
  const key = String(label || '').toLowerCase().trim();
  if (LESION_LABELS[key]) return key;
  const aliases = {
    'label_0': 'akiec',
    'label_1': 'bcc',
    'label_2': 'bkl',
    'label_3': 'df',
    'label_4': 'mel',
    'label_5': 'nv',
    'label_6': 'vasc',
    '0': 'akiec',
    '1': 'bcc',
    '2': 'bkl',
    '3': 'df',
    '4': 'mel',
    '5': 'nv',
    '6': 'vasc',
    'actinic keratoses': 'akiec',
    'actinic keratosis': 'akiec',
    'basal cell carcinoma': 'bcc',
    'benign keratosis': 'bkl',
    'benign keratosis-like lesions': 'bkl',
    'dermatofibroma': 'df',
    'melanoma': 'mel',
    'melanocytic nevi': 'nv',
    'melanocytic nevus': 'nv',
    'vascular lesions': 'vasc',
    'vascular lesion': 'vasc'
  };
  return aliases[key] || key;
}

function percent(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function buildScreeningResult(predictions) {
  const normalized = predictions.map(p => ({
    key: normalizeModelLabel(p.label),
    label: p.label,
    score: Number(p.score) || 0
  }));

  const malignant = normalized
    .filter(p => LESION_LABELS[p.key]?.malignant)
    .reduce((sum, p) => sum + p.score, 0);
  const benign = Math.max(0, 1 - malignant);
  const top = normalized[0] || { key: 'unknown', label: 'Unknown', score: 0 };
  const topInfo = LESION_LABELS[top.key];

  // Screening thresholds are intentionally conservative. They are NOT
  // clinical diagnostic thresholds and should never be treated as one.
  let risk = 'Low Risk';
  let riskClass = 'low';
  if (malignant >= 0.50) {
    risk = 'High Risk';
    riskClass = 'high';
  } else if (malignant >= 0.15) {
    risk = 'Medium Risk';
    riskClass = 'medium';
  }

  let explanation;
  if (topInfo?.malignant) {
    explanation = `${topInfo.name} is the model's top predicted lesion category. The combined probability assigned to malignant categories is ${percent(malignant)}%. This is a screening result, not a cancer diagnosis.`;
  } else {
    explanation = `${topInfo?.name || top.label} is the model's top predicted lesion category. The combined probability assigned to malignant categories is ${percent(malignant)}%. A dermatologist should review any changing, bleeding, painful, or concerning lesion.`;
  }

  return {
    benign: percent(benign),
    malignant: percent(malignant),
    confidence: percent(top.score),
    precision: null,
    recall: null,
    f1: null,
    accuracy: null,
    validationAccuracy: null,
    topClass: topInfo?.name || top.label,
    topClassCode: top.key,
    risk,
    riskClass,
    explanation,
    model: SKIN_MODEL_ID,
    predictions: normalized.slice(0, 7).map(p => ({ label: LESION_LABELS[p.key]?.name || p.label, score: p.score }))
  };
}

async function analyzeSkinImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Please upload a valid image file.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Image is larger than 10 MB. Please choose a smaller image.');
  }

  const classifier = await getSkinClassifier();
  setModelStatus('Analyzing image…', 'loading');

  const objectUrl = URL.createObjectURL(file);
  try {
    const predictions = await classifier(objectUrl, { top_k: 7 });
    return buildScreeningResult(predictions);
  } finally {
    URL.revokeObjectURL(objectUrl);
    setModelStatus('AI model ready • running privately in your browser', 'ready');
  }
}

/* ========================================
   EMERGENCY ALERTS
   ======================================== */

function shouldNotifyEmergencyContact(data) {
  // Notify when the model's top class is a malignant/pre-cancerous HAM10000 class.
  // This is an AI screening alert, NOT a confirmed cancer diagnosis.
  return ['akiec', 'bcc', 'mel'].includes(data?.topClassCode);
}

function getEmergencyNotificationPayload(data) {
  const profile = getPersonalProfile();
  if (!profile || !isProfileComplete(profile)) return null;
  const method = profile.emergencyAlertMethod || 'sms';
  const patientDetails = {
    name: profile.name,
    phone: profile.phone,
    email: profile.email,
    dateOfBirth: profile.dob || 'Not provided',
    city: profile.city || 'Not provided',
    emergencyContact: profile.emergencyName,
    emergencyRelationship: profile.emergencyRelationship,
    scanTime: new Date().toLocaleString()
  };
  return {
    method,
    emergencyName: profile.emergencyName,
    emergencyPhone: profile.emergencyPhone,
    emergencyEmail: profile.emergencyEmail,
    emergencyVerificationToken: profile.emergencyVerificationToken,
    emergencyVerificationKey: profile.emergencyVerificationKey,
    patient: patientDetails,
    report: {
      result: data.topClass || 'Concerning skin lesion',
      resultCode: data.topClassCode || 'unknown',
      confidence: data.confidence,
      malignantProbability: data.malignant,
      benignProbability: data.benign,
      risk: data.risk,
      explanation: data.explanation,
      model: data.model,
      timestamp: patientDetails.scanTime
    }
  };
}

async function notifyEmergencyContact(data) {
  if (!shouldNotifyEmergencyContact(data)) return { sent: false, skipped: true };

  const payload = getEmergencyNotificationPayload(data);
  if (!payload) return { sent: false, skipped: true };

  try {
    const response = await fetch(`${NOTIFICATION_API_URL}/notify-emergency`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Emergency notification service is unavailable.');
    return result;
  } catch (error) {
    console.error('Emergency notification failed:', error);
    return { sent: false, error: error.message };
  }
}

function showEmergencyAlertStatus(result) {
  if (!result || result.skipped) return;
  if (result.sent) {
    const channels = (result.channels || []).join(' + ').toUpperCase();
    alert(`⚠️ The AI screening flagged a concerning lesion. An emergency alert was sent to the registered emergency contact via ${channels || 'the configured alert service'}.\n\nThis is not a confirmed diagnosis. Please arrange prompt dermatologist evaluation.`);
  } else if (result.error) {
    alert(`⚠️ The AI screening flagged a concerning lesion, but the emergency alert could not be sent.\n\nPlease contact your emergency contact manually and arrange prompt dermatologist evaluation.\n\nTechnical detail: ${result.error}`);
  }
}

/* ========================================
   ANALYZE
   ======================================== */

/* ========================================
   PERSIST ANALYSIS TO SERVER (Phase 3)
   ======================================== */

// Uploads the image + screening result to the DERMAMIND server so it's
// durably stored (SQLite record + image file) instead of only living in
// this browser's localStorage. Deliberately non-blocking for the on-screen
// result: if the server is unreachable, the user still sees their result
// and it's still in local history — it just isn't backed up to the server
// for this scan. The dedicated Patient History section (a later phase)
// will read from the server as the source of truth.
async function uploadAnalysisToServer(data, file, heatmapBlob) {
  try {
    await DermaMindAPI.createAnalysis(file, {
      predictedClass: data.topClassCode || data.topClass,
      confidence: data.confidence,
      classProbabilities: data.predictions,
      imageQualityStatus: data.imageQualityStatus,
      imageValidationMessage: data.imageValidationMessage,
      modelName: data.model,
      screeningResult: { risk: data.risk, riskClass: data.riskClass, explanation: data.explanation },
      disclaimerAcknowledged: true
    }, heatmapBlob || null);
  } catch (error) {
    console.error('Could not save this scan to the server:', error);
  }
}

analyzeBtn.addEventListener('click', async () => {
  if (!requireCompletedProfile('start an AI skin scan')) return;

  if (!document.getElementById('consent').checked) {
    alert('Please accept the terms and privacy policy.');
    return;
  }

  if (!selectedFile) {
    alert('Please upload an image first.');
    return;
  }

  // Hard block, independent of the button's disabled state — belt-and-braces
  // so an invalid image can never reach the skin-lesion classifier.
  if (lastImageValidation?.status === 'invalid') {
    alert(lastImageValidation.message);
    return;
  }
  if (lastImageValidation === null) {
    alert('Image is still being checked — please wait a moment and try again.');
    return;
  }

  const originalText = analyzeBtn.innerHTML;
  analyzeBtn.innerHTML = 'Analyzing…';
  analyzeBtn.disabled = true;

  try {
    const data = await analyzeSkinImage(selectedFile);
    data.imageQualityStatus = lastImageValidation.status;
    data.imageValidationMessage = lastImageValidation.reasons.join(' ') || null;
    showResult(data);
    saveHistory(data);
    generateHeatmapAsync(data, selectedFile); // runs in the background; uploads to server once done
    getLocation(data.risk);
    updateDashboardStats();
    const emergencyAlert = await notifyEmergencyContact(data);
    showEmergencyAlertStatus(emergencyAlert);
  } catch (error) {
    console.error('AI analysis error:', error);
    alert(`AI analysis could not be completed. ${error.message || 'Please try again.'}`);
  } finally {
    analyzeBtn.innerHTML = originalText;
    analyzeBtn.disabled = false;
  }
});

/* ========================================
   SHOW RESULT
   ======================================== */

function showResult(data) {
  analysisPlaceholder.style.display = 'none';
  resultCard.classList.remove('hidden');
  resultCard.style.display = 'block';
  
  document.getElementById('resultTimestamp').textContent = new Date().toLocaleString();
  
  document.getElementById('benignScore').style.width = data.benign + '%';
  document.getElementById('malignantScore').style.width = data.malignant + '%';
  document.getElementById('benignValue').textContent = data.benign + '%';
  document.getElementById('malignantValue').textContent = data.malignant + '%';
  
  confidence.textContent = data.confidence + '%';
  
  document.getElementById('precision').textContent = data.validationAccuracy ? data.validationAccuracy.toFixed(2) + '%' : 'Not provided';
  document.getElementById('recall').textContent = data.malignant + '%';
  document.getElementById('f1score').textContent = data.topClass || '—';
  document.getElementById('accuracy').textContent = data.model ? 'ViT ONNX' : '—';
  const topClassEl = document.getElementById('topClass');
  if (topClassEl) topClassEl.textContent = data.topClass || 'Unknown';
  
  riskResult.textContent = data.risk;
  riskResult.className = 'risk-badge ' + data.riskClass;
  explanation.textContent = data.explanation;

  resetXaiView(data);

  resultCard.scrollIntoView({ behavior: 'smooth' });
  
  alert('Analysis complete! Results are displayed below.');
}

/* ========================================
   XAI HEATMAP (Phase 7)
   ======================================== */

const xaiImage = document.getElementById('xaiImage');
const xaiLoading = document.getElementById('xaiLoading');
const xaiTabs = document.querySelectorAll('.xai-tab');
let currentXai = null; // { originalUrl, heatmapDataUrl, overlayDataUrl } for the scan on screen

function setXaiTabActive(view) {
  xaiTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.xaiView === view));
}

function showXaiView(view) {
  if (!currentXai) return;
  setXaiTabActive(view);
  if (view === 'original') {
    xaiImage.src = currentXai.originalUrl;
  } else if (view === 'heatmap') {
    if (currentXai.heatmapDataUrl) { xaiImage.src = currentXai.heatmapDataUrl; }
  } else if (view === 'overlay') {
    if (currentXai.overlayDataUrl) { xaiImage.src = currentXai.overlayDataUrl; }
  }
}

xaiTabs.forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.xaiView;
    if ((view === 'heatmap' || view === 'overlay') && !currentXai?.heatmapDataUrl) {
      return; // not ready yet — ignore the click rather than show a blank image
    }
    showXaiView(view);
  });
});

function resetXaiView(data) {
  currentXai = { originalUrl: preview.src, heatmapDataUrl: null, overlayDataUrl: null };
  showXaiView('original');
  xaiLoading.classList.remove('hidden');
  xaiLoading.textContent = 'Generating explanation… this takes a few seconds.';
}

// Warns before the tab is closed/reloaded/navigated away from while a
// heatmap is still generating -- without this, an interrupted generation
// silently loses the heatmap for that scan (it's only uploaded to the
// server once generation finishes).
let heatmapGenerationsInFlight = 0;
window.addEventListener('beforeunload', (e) => {
  if (heatmapGenerationsInFlight > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Runs occlusion-sensitivity XAI in the background after the main result is
// already on screen, so the person isn't stuck waiting for it. Once ready,
// it uploads the finished heatmap alongside the analysis record.
async function generateHeatmapAsync(data, file) {
  const thisXai = currentXai; // guards against a newer scan racing ahead of this one
  heatmapGenerationsInFlight++;
  try {
    const classifier = await getSkinClassifier();
    const result = await XAI.generateOcclusionHeatmap(
      classifier,
      file,
      data.topClassCode,
      normalizeModelLabel,
      (done, total) => {
        if (currentXai === thisXai) {
          xaiLoading.textContent = `Generating explanation… analyzing region ${done}/${total}. Please stay on this page.`;
        }
      }
    );
    if (currentXai === thisXai) {
      currentXai.heatmapDataUrl = result.heatmapDataUrl;
      currentXai.overlayDataUrl = result.overlayDataUrl;
      xaiLoading.classList.add('hidden');
    }
    const heatmapBlob = await XAI.dataUrlToBlob(result.heatmapDataUrl);
    uploadAnalysisToServer(data, file, heatmapBlob);
  } catch (error) {
    console.error('Could not generate XAI heatmap:', error);
    if (currentXai === thisXai) {
      xaiLoading.textContent = 'Explanation unavailable for this scan.';
    }
    uploadAnalysisToServer(data, file, null); // still save the scan without a heatmap
  } finally {
    heatmapGenerationsInFlight--;
  }
}

/* ========================================
   HISTORY
   ======================================== */

function saveHistory(data) {
  let history = JSON.parse(localStorage.getItem('scans')) || [];
  history.push({ ...data, date: new Date().toLocaleString(), imageName: selectedFile?.name || 'Unknown' });
  localStorage.setItem('scans', JSON.stringify(history));
}

// The Scan History PAGE reads from the server (the authoritative,
// user-scoped record) rather than localStorage -- this is what makes
// "User A can never see User B's history" actually true, since the API
// enforces that per request, not per browser profile.
const historyImageUrlCache = new Map(); // analysisId -> blob url, so we don't re-fetch on every render

async function renderHistoryList() {
  historyList.innerHTML = '<p class="text-muted" style="padding:40px;text-align:center;">Loading your scan history…</p>';

  let analyses;
  try {
    analyses = await DermaMindAPI.listAnalyses();
  } catch (error) {
    historyList.innerHTML = `<p class="text-muted" style="padding:40px;text-align:center;">Could not load your scan history. ${error.message || 'Please try again.'}</p>`;
    return;
  }

  if (!analyses || analyses.length === 0) {
    historyList.innerHTML = '<p class="text-muted" style="padding:40px;text-align:center;">No previous scans found.</p>';
    return;
  }

  historyList.innerHTML = '';
  analyses.forEach(item => {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const risk = item.screeningResult?.risk || 'Unknown risk';
    const riskClass = item.screeningResult?.riskClass || '';
    const dateStr = new Date(item.createdAt).toLocaleString();
    const qualityBadge = item.imageQualityStatus ? ` · Quality: ${item.imageQualityStatus}` : '';

    card.innerHTML = `
      <img class="history-thumb" alt="Scan thumbnail" src="">
      <div class="history-main">
        <div class="history-date">${dateStr}</div>
        <div class="history-result">${item.predictedClass || 'Unknown'} <span class="risk-badge ${riskClass}" style="font-size:0.7rem;padding:2px 8px;">${risk}</span></div>
        <div class="history-meta">${item.confidence != null ? item.confidence + '% confidence' : ''}${qualityBadge}</div>
      </div>
      <div class="history-actions">
        <button type="button" class="history-delete-btn">Delete</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.history-delete-btn')) return;
      openHistoryDetail(item.id);
    });
    card.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') openHistoryDetail(item.id);
    });
    card.querySelector('.history-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteHistoryItem(item.id);
    });

    historyList.appendChild(card);

    // Load the thumbnail without blocking the rest of the list from rendering.
    if (item.hasOriginalImage) {
      getCachedImageUrl(item.id, 'image').then(url => {
        if (url) card.querySelector('.history-thumb').src = url;
      });
    }
  });
}

async function getCachedImageUrl(analysisId, kind) {
  const cacheKey = `${analysisId}:${kind}`;
  if (historyImageUrlCache.has(cacheKey)) return historyImageUrlCache.get(cacheKey);
  const url = await DermaMindAPI.getAnalysisImageUrl(analysisId, kind);
  if (url) historyImageUrlCache.set(cacheKey, url);
  return url;
}

async function deleteHistoryItem(analysisId) {
  if (!confirm('Delete this scan from your history? This cannot be undone.')) return;
  try {
    await DermaMindAPI.deleteAnalysis(analysisId);
    renderHistoryList();
  } catch (error) {
    alert(`Could not delete this scan. ${error.message || 'Please try again.'}`);
  }
}

async function openHistoryDetail(analysisId) {
  const overlay = document.getElementById('historyDetailOverlay');
  const content = document.getElementById('historyDetailContent');
  overlay.classList.remove('hidden');
  content.innerHTML = '<p class="text-muted" style="padding:30px;text-align:center;">Loading…</p>';

  let item;
  try {
    item = await DermaMindAPI.getAnalysis(analysisId);
  } catch (error) {
    content.innerHTML = `<p class="text-muted">Could not load this scan. ${error.message || ''}</p>`;
    return;
  }

  const originalUrl = item.hasOriginalImage ? await getCachedImageUrl(analysisId, 'image') : null;
  const heatmapUrl = item.hasHeatmap ? await getCachedImageUrl(analysisId, 'heatmap') : null;

  const risk = item.screeningResult?.risk || 'Unknown';
  const riskClass = item.screeningResult?.riskClass || '';
  const explanation = item.screeningResult?.explanation || '';
  const dateStr = new Date(item.createdAt).toLocaleString();

  const probsHtml = Array.isArray(item.classProbabilities)
    ? item.classProbabilities.map(p => `<div class="history-prob-row"><span>${p.label || p.key}</span><span>${((p.score || 0) * 100).toFixed(1)}%</span></div>`).join('')
    : '';

  const descHtml = item.userDescription && Object.keys(item.userDescription).length
    ? `<div class="history-detail-section"><h4>User-provided information</h4>${Object.entries(item.userDescription).map(([k, v]) => `<div class="history-prob-row"><span>${k}</span><span>${v}</span></div>`).join('')}</div>`
    : '';

  content.innerHTML = `
    <h3 style="margin-top:0;">${item.predictedClass || 'Unknown'}</h3>
    <p class="result-subtext">${dateStr} · Model: ${item.modelName || 'Unknown'}</p>

    <div class="xai-tabs" id="historyXaiTabs">
      <button type="button" class="xai-tab active" data-view="original">Original</button>
      ${heatmapUrl ? '<button type="button" class="xai-tab" data-view="heatmap">Heatmap</button>' : ''}
      ${heatmapUrl ? '<button type="button" class="xai-tab" data-view="overlay">Overlay</button>' : ''}
    </div>
    <div class="xai-image-wrap">
      <img id="historyDetailImage" alt="Scan" src="${originalUrl || ''}">
    </div>
    ${heatmapUrl ? '<p class="result-subtext">The highlighted regions represent image areas that contributed to the model\'s prediction. They are not proof of cancer.</p>' : ''}

    <div class="history-detail-section">
      <h4>Risk assessment</h4>
      <span class="risk-badge ${riskClass}">${risk}</span>
      <p class="risk-text">${explanation}</p>
    </div>

    ${item.confidence != null ? `<div class="history-detail-section"><h4>Confidence</h4><p>${item.confidence}%</p></div>` : ''}
    ${probsHtml ? `<div class="history-detail-section"><h4>Class probabilities</h4>${probsHtml}</div>` : ''}
    ${item.imageQualityStatus ? `<div class="history-detail-section"><h4>Image quality</h4><p>${item.imageQualityStatus}${item.imageValidationMessage ? ' — ' + item.imageValidationMessage : ''}</p></div>` : ''}
    ${descHtml}

    <div class="history-detail-section" style="display:flex; gap:10px;">
      <button type="button" class="download-btn" id="historyDownloadReportBtn" style="flex:1;">Download Report</button>
      <button type="button" class="history-delete-btn" id="historyDeleteFromDetailBtn" style="flex:0 0 auto;">Delete</button>
    </div>
  `;

  if (heatmapUrl) {
    let overlayUrl = null;
    content.querySelectorAll('#historyXaiTabs .xai-tab').forEach(btn => {
      btn.addEventListener('click', async () => {
        content.querySelectorAll('#historyXaiTabs .xai-tab').forEach(b => b.classList.toggle('active', b === btn));
        const view = btn.dataset.view;
        const img = document.getElementById('historyDetailImage');
        if (view === 'original') img.src = originalUrl;
        else if (view === 'heatmap') img.src = heatmapUrl;
        else if (view === 'overlay') {
          if (!overlayUrl) overlayUrl = await XAI.composeOverlay(originalUrl, heatmapUrl);
          img.src = overlayUrl;
        }
      });
    });
  }

  document.getElementById('historyDeleteFromDetailBtn').addEventListener('click', async () => {
    closeHistoryDetail();
    await deleteHistoryItem(analysisId);
  });
  document.getElementById('historyDownloadReportBtn').addEventListener('click', () => {
    downloadHistoryReport(item);
  });
}

function closeHistoryDetail() {
  document.getElementById('historyDetailOverlay').classList.add('hidden');
}

function downloadHistoryReport(item) {
  const risk = item.screeningResult?.risk || 'Unknown';
  const explanation = item.screeningResult?.explanation || '';
  const report = `DERMAMIND — AI-Assisted Skin Screening Report
Generated: ${new Date().toLocaleString()}
Scan date: ${new Date(item.createdAt).toLocaleString()}
Analysis ID: ${item.id}

PREDICTION
Top predicted lesion: ${item.predictedClass || 'Unknown'}
Confidence: ${item.confidence != null ? item.confidence + '%' : 'N/A'}
Model: ${item.modelName || 'Unknown'}

RISK ASSESSMENT
Risk level: ${risk}
${explanation}

IMAGE QUALITY
${item.imageQualityStatus || 'Not recorded'}${item.imageValidationMessage ? ' — ' + item.imageValidationMessage : ''}

This is an AI-assisted screening result for research/informational purposes.
It does not replace professional medical diagnosis. Please consult a
qualified dermatologist for any concerning skin changes.
© DERMAMIND`;

  const blob = new Blob([report], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Dermamind_Report_${item.id}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function loadRecentScansPreview() {
  const previewEl = document.getElementById('recentScansPreview');
  let history = JSON.parse(localStorage.getItem('scans')) || [];
  
  if (history.length === 0) {
    previewEl.innerHTML = '<p class="text-muted">No recent scans. Start your first AI analysis!</p>';
    return;
  }
  
  const recentScans = history.slice(-3).reverse();
  previewEl.innerHTML = '';
  
  recentScans.forEach(scan => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;';
    div.innerHTML = `
      <div><div style="font-size:0.75rem;color:var(--text-muted);">${scan.date}</div><div style="font-weight:600;">${scan.risk}</div></div>
      <div style="color:var(--primary);font-weight:600;">${scan.confidence}%</div>
    `;
    previewEl.appendChild(div);
  });
}

loadRecentScansPreview();

/* ========================================
   STATS
   ======================================== */

function updateDashboardStats() {
  const scans = JSON.parse(localStorage.getItem('scans')) || [];
  const appointments = JSON.parse(localStorage.getItem('appointments')) || [];
  const consultations = JSON.parse(localStorage.getItem('consultations')) || [];
  
  document.getElementById('totalScans').textContent = scans.length;
  document.getElementById('totalAppointments').textContent = appointments.length + consultations.length;
}

updateDashboardStats();

/* ========================================
   HOSPITALS + LOCATION
   ======================================== */

let detectedLocation = null;
let nearbyHospitals = [];

/* ========================================
   GOOGLE PLACES (NEW) - NEARBY HEALTHCARE
   ======================================== */

const GOOGLE_PLACES_NEARBY_ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
const GOOGLE_PLACES_TEXT_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.nationalPhoneNumber',
  'places.regularOpeningHours',
  'places.primaryType',
  'places.types',
  'places.googleMapsUri',
  'places.websiteUri'
].join(',');

function getGooglePlacesApiKey() {
  return String(window.DERMAMIND_CONFIG?.GOOGLE_PLACES_API_KEY || '').trim();
}

function googlePlacesConfigured() {
  const key = getGooglePlacesApiKey();
  return key && !key.includes('PASTE_YOUR') && key.length > 20;
}

function googlePlacesSetupMessage() {
  return `
    <div class="location-prompt-content">
      <div class="location-icon">🔑</div>
      <h3>Google Places is not configured</h3>
      <p>Add your Google Places API key in <strong>google-places-config.js</strong>, then reload DERMAMIND.</p>
      <p class="text-muted">Enable Places API (New) in Google Cloud and restrict the key to your DERMAMIND web origin.</p>
    </div>`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function googleDirectionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

async function fetchGooglePlaces(endpoint, body) {
  const apiKey = getGooglePlacesApiKey();
  if (!googlePlacesConfigured()) throw new Error('GOOGLE_PLACES_API_KEY_NOT_CONFIGURED');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let details = '';
    try { details = await res.text(); } catch (_) {}
    throw new Error(`Google Places ${res.status}${details ? `: ${details.slice(0, 220)}` : ''}`);
  }
  return res.json();
}

async function fetchGoogleNearbyHealthcare(lat, lng) {
  return fetchGooglePlaces(GOOGLE_PLACES_NEARBY_ENDPOINT, {
    includedTypes: [
      'skin_care_clinic',
      'medical_clinic',
      'medical_center',
      'hospital',
      'general_hospital',
      'doctor'
    ],
    maxResultCount: 20,
    rankPreference: 'DISTANCE',
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 10000
      }
    }
  });
}

async function fetchGoogleDermatologySearch(lat, lng) {
  return fetchGooglePlaces(GOOGLE_PLACES_TEXT_ENDPOINT, {
    textQuery: 'dermatologist dermatology skin clinic',
    pageSize: 20,
    rankPreference: 'DISTANCE',
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 15000
      }
    },
    strictTypeFiltering: false
  });
}

function placeIsDermatology(place) {
  const types = (place.types || []).map(t => String(t).toLowerCase());
  const text = [place.displayName?.text, place.primaryType, ...types].filter(Boolean).join(' ');
  return /dermat|skin.?care|skin_care_clinic/i.test(text);
}

function normalizeGooglePlace(place, userLat, userLng) {
  const lat = Number(place.location?.latitude);
  const lng = Number(place.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const name = place.displayName?.text || 'Nearby Dermatology / Skin Care Provider';
  const types = Array.isArray(place.types) ? place.types : [];
  const specialist = placeIsDermatology(place);
  const primaryType = String(place.primaryType || '').replace(/_/g, ' ');
  const typeLabel = specialist
    ? 'Dermatology / Skin Care'
    : (/hospital/i.test(primaryType) || types.some(t => /hospital/i.test(t)) ? 'Hospital • Dermatology Referral' : 'Medical Clinic • Dermatology Referral');

  return {
    id: `google-${place.id}`,
    googlePlaceId: place.id,
    name,
    address: place.formattedAddress || 'Address available on Google Maps',
    phone: place.nationalPhoneNumber || '',
    website: place.websiteUri || '',
    hours: place.regularOpeningHours?.weekdayDescriptions?.join(' • ') || '',
    openNow: typeof place.regularOpeningHours?.openNow === 'boolean' ? place.regularOpeningHours.openNow : null,
    rating: Number.isFinite(Number(place.rating)) ? Number(place.rating) : null,
    reviews: Number.isFinite(Number(place.userRatingCount)) ? Number(place.userRatingCount) : null,
    primaryType,
    typeLabel,
    specialist,
    lat,
    lng,
    distance: Number(calculateDistance(userLat, userLng, lat, lng)),
    mapsUrl: place.googleMapsUri || googleDirectionsUrl(lat, lng)
  };
}

async function fetchNearbyDermatologyPlaces(lat, lng) {
  // Two Google Places searches are merged: a precise dermatology text search
  // plus a nearby healthcare search for hospitals/clinics that may have a
  // dermatology department but are not categorized as skin-care clinics.
  const [specialistResult, healthcareResult] = await Promise.allSettled([
    fetchGoogleDermatologySearch(lat, lng),
    fetchGoogleNearbyHealthcare(lat, lng)
  ]);

  const errors = [];
  const places = [];

  if (specialistResult.status === 'fulfilled') places.push(...(specialistResult.value.places || []));
  else errors.push(specialistResult.reason);

  if (healthcareResult.status === 'fulfilled') places.push(...(healthcareResult.value.places || []));
  else errors.push(healthcareResult.reason);

  if (!places.length) throw (errors[0] || new Error('No Google Places results'));

  const unique = new Map();
  places.forEach(place => {
    if (place?.id && !unique.has(place.id)) unique.set(place.id, place);
  });

  const normalized = [...unique.values()]
    .map(place => normalizeGooglePlace(place, lat, lng))
    .filter(Boolean);

  // Dermatology providers first, then nearby hospitals/clinics. Within each
  // group, nearest locations appear first.
  normalized.sort((a, b) => Number(b.specialist) - Number(a.specialist) || a.distance - b.distance);
  return normalized;
}

function getLocation(risk) {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => loadHospitals(risk, position.coords.latitude, position.coords.longitude),
      () => loadHospitals(risk, null, null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  } else {
    loadHospitals(risk, null, null);
  }
}

async function loadHospitals(risk, lat, lng) {
  const showHospitals = String(risk || '').toLowerCase().includes('high') || String(risk || '').toLowerCase().includes('medium');

  if (!showHospitals) {
    hospitalSection.classList.add('hidden');
    return;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    hospitalSection.classList.remove('hidden');
    hospitalList.innerHTML = `
      <div class="location-prompt-content">
        <div class="location-icon">📍</div>
        <h3>Location needed</h3>
        <p>Allow location access to see nearby dermatology hospitals and clinics <strong>inside DERMAMIND</strong>.</p>
        <button onclick="detectUserLocation()">Detect My Location</button>
      </div>`;
    return;
  }

  hospitalSection.classList.remove('hidden');
  hospitalList.innerHTML = '<p class="hospitals-status">Finding nearby dermatology hospitals and clinics with Google Places…</p>';

  try {
    if (!googlePlacesConfigured()) {
      hospitalList.innerHTML = googlePlacesSetupMessage();
      return;
    }
    const places = await fetchNearbyDermatologyPlaces(lat, lng);
    nearbyHospitals = places;
    renderHospitalCards(nearbyHospitals, hospitalList);
  } catch (error) {
    console.error('Google Places hospital search failed:', error);
    hospitalList.innerHTML = `
      <div class="location-prompt-content">
        <div class="location-icon">⚠️</div>
        <h3>Could not load nearby hospitals</h3>
        <p>Google Places could not return nearby healthcare locations. Check your API key, Places API (New) setup, billing, internet connection, and try again.</p>
        <button onclick="detectUserLocation()">Try Again</button>
      </div>`;
  }
}

function prepareHospitalsSection() {
  const saved = detectedLocation;
  if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
    document.getElementById('hospitalsLocationPrompt').classList.add('hidden');
    document.getElementById('hospitalsCards').classList.remove('hidden');
    document.getElementById('hospitalsStatus').textContent = '📍 Using your saved location. Google Places results are displayed directly below.';
    loadHospitalsList(saved.lat, saved.lng);
  }
}

function detectUserLocation() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }

  const btn = document.getElementById('detectLocationBtn');
  if (btn) {
    btn.textContent = 'Detecting location…';
    btn.disabled = true;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      detectedLocation = { lat, lng };
      localStorage.setItem('dermamindLocation', JSON.stringify(detectedLocation));

      document.getElementById('hospitalsLocationPrompt').classList.add('hidden');
      document.getElementById('hospitalsCards').classList.remove('hidden');
      document.getElementById('hospitalsStatus').textContent = '📍 Location detected. Showing nearby dermatology hospitals and clinics directly in DERMAMIND.';

      await loadHospitalsList(lat, lng);
      if (btn) {
        btn.textContent = 'Refresh My Location';
        btn.disabled = false;
      }
    },
    (error) => {
      if (btn) {
        btn.textContent = 'Detect My Location';
        btn.disabled = false;
      }
      if (error.code === error.PERMISSION_DENIED) {
        alert('Location permission was denied. Please enable location access in your browser and try again.');
      } else {
        alert('Unable to detect your location. Please try again.');
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
  );
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return (R*c).toFixed(2);
}

async function loadHospitalsList(lat, lng) {
  const hospitalsListEl = document.getElementById('hospitalsList');
  hospitalsListEl.innerHTML = `
    <div class="hospital-loading">
      <div class="hospital-spinner"></div>
      <h3>Finding nearby skin-care hospitals…</h3>
      <p>Searching Google Places around your current location.</p>
    </div>`;

  if (!googlePlacesConfigured()) {
    hospitalsListEl.innerHTML = googlePlacesSetupMessage();
    document.getElementById('hospitalCount').textContent = '—';
    return;
  }

  try {
    nearbyHospitals = await fetchNearbyDermatologyPlaces(lat, lng);
    renderHospitalCards(nearbyHospitals, hospitalsListEl);
    document.getElementById('hospitalCount').textContent = nearbyHospitals.length;
  } catch (error) {
    console.error('Google Places error:', error);
    hospitalsListEl.innerHTML = `
      <div class="location-prompt-content">
        <div class="location-icon">⚠️</div>
        <h3>Hospital search is temporarily unavailable</h3>
        <p>DERMAMIND couldn't reach Google Places. Verify the API key and Places API (New) configuration, then try again.</p>
        <button onclick="loadHospitalsList(${lat}, ${lng})">Try Again</button>
      </div>`;
    document.getElementById('hospitalCount').textContent = '—';
  }
}

function renderHospitalCards(hospitals, container) {
  container.innerHTML = '';
  document.getElementById('hospitalCount').textContent = hospitals.length;

  hospitals.slice(0, 20).forEach((h, index) => {
    const card = document.createElement('div');
    card.className = 'hospital-card-full';
    const phoneHtml = h.phone ? `<p><strong>Phone:</strong> ${escapeHtml(h.phone)}</p>` : '';
    const hoursHtml = h.hours ? `<p><strong>Hours:</strong> ${escapeHtml(h.hours)}</p>` : '';
    const ratingHtml = h.rating !== null ? `<p><strong>⭐ Rating:</strong> ${h.rating.toFixed(1)}${h.reviews !== null ? ` (${h.reviews.toLocaleString()} reviews)` : ''}</p>` : '';
    const websiteHtml = h.website ? `<a href="${escapeHtml(h.website)}" target="_blank" rel="noopener" class="small button secondary">🌐 Website</a>` : '';
    const openStatus = h.openNow === true ? '<span class="hospital-open-status">Open now</span>' : h.openNow === false ? '<span class="hospital-closed-status">Closed now</span>' : '';

    card.innerHTML = `
      <div class="hospital-card-header">
        <div class="hospital-card-title">
          <span class="hospital-rank">#${index + 1}</span>
          <h3>${escapeHtml(h.name)}</h3>
          <div class="hospital-specialty">🩺 ${escapeHtml(h.typeLabel)} ${openStatus}</div>
        </div>
        <div class="hospital-card-distance">${h.distance.toFixed(1)} km</div>
      </div>
      <div class="hospital-card-body">
        <p><strong>📍 Address:</strong> ${escapeHtml(h.address)}</p>
        ${ratingHtml}
        ${phoneHtml}
        ${hoursHtml}
      </div>
      <div class="hospital-card-actions">
        <button class="small consult-action" onclick="openConsultationModal('${escapeHtml(h.id)}')">👨‍⚕️ Consult Dermatologist</button>
        <button class="small secondary" onclick="selectHospital('${escapeHtml(h.id)}')">📅 Book Visit</button>
        <a href="${escapeHtml(h.mapsUrl || googleDirectionsUrl(h.lat, h.lng))}" target="_blank" rel="noopener" class="small button directions-link">🧭 Google Maps</a>
        ${h.phone ? `<a href="tel:${encodeURIComponent(h.phone)}" class="small button secondary">📞 Call</a>` : ''}
        ${websiteHtml}
      </div>`;
    container.appendChild(card);
  });

  // Required Google Places attribution is kept visible with the in-app list.
  const attribution = document.createElement('p');
  attribution.className = 'data-source-note';
  attribution.textContent = 'Places data by Google • Results are displayed inside DERMAMIND. Provider availability and consultation services should be confirmed with the provider.';
  container.appendChild(attribution);

  if (!hospitals.length) {
    container.innerHTML = `
      <div class="location-prompt-content">
        <div class="location-icon">🔎</div>
        <h3>No nearby dermatology hospitals found</h3>
        <p>Try refreshing your location or searching again later.</p>
        <button onclick="detectUserLocation()">Refresh Search</button>
      </div>`;
  }
}

function selectHospital(hospitalId) {
  if (!requireCompletedProfile('book a hospital visit')) return;
  const hospital = nearbyHospitals.find(h => h.id === hospitalId);
  if (!hospital) return;
  populateHospitalSelect(hospital);
  document.querySelector('[data-section="appointments"]').click();
  document.getElementById('pname').focus();
}

function populateHospitalSelect(selectedHospital) {
  const select = document.getElementById('hospitalSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Select a hospital / clinic...</option>';
  nearbyHospitals.forEach(h => {
    const option = document.createElement('option');
    option.value = h.id;
    option.textContent = `${h.name} — ${h.distance.toFixed(1)} km`;
    select.appendChild(option);
  });
  if (selectedHospital) select.value = selectedHospital.id;
}

/* ========================================
   DERMATOLOGIST CONSULTATION
   ======================================== */

function openConsultationModal(hospitalId) {
  if (!requireCompletedProfile('request a dermatologist consultation')) return;
  const hospital = nearbyHospitals.find(h => h.id === hospitalId);
  if (!hospital) return;

  const modal = document.getElementById('consultationModal');
  document.getElementById('consultationHospital').value = hospital.id;
  document.getElementById('consultationHospitalName').textContent = `${hospital.name} • ${hospital.distance.toFixed(1)} km away`;

  const profile = getPersonalProfile();
  const user = getLoggedUserObject();
  document.getElementById('consultationName').value = profile?.name || user?.name || '';
  document.getElementById('consultationPhone').value = profile?.phone || '';
  document.getElementById('consultationNotes').value = '';

  const today = new Date().toISOString().split('T')[0];
  document.getElementById('consultationDate').min = today;
  document.getElementById('consultationDate').value = today;

  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeConsultationModal() {
  const modal = document.getElementById('consultationModal');
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

document.getElementById('consultationModal')?.addEventListener('click', (event) => {
  if (event.target.id === 'consultationModal') closeConsultationModal();
});

document.querySelectorAll('.consultation-type-card input').forEach(input => {
  input.addEventListener('change', () => {
    document.querySelectorAll('.consultation-type-card').forEach(card => card.classList.remove('active'));
    input.closest('.consultation-type-card')?.classList.add('active');
  });
});

document.getElementById('consultationForm')?.addEventListener('submit', (e) => {
  e.preventDefault();

  const hospitalId = document.getElementById('consultationHospital').value;
  const hospital = nearbyHospitals.find(h => h.id === hospitalId);
  if (!hospital) {
    alert('Please select a valid nearby dermatologist.');
    return;
  }

  const type = document.querySelector('input[name="consultationType"]:checked')?.value || 'Video Consultation';
  const name = document.getElementById('consultationName').value.trim();
  const phone = document.getElementById('consultationPhone').value.trim();
  const date = document.getElementById('consultationDate').value;
  const time = document.getElementById('consultationTime').value;
  const notes = document.getElementById('consultationNotes').value.trim();

  let consultations = JSON.parse(localStorage.getItem('consultations')) || [];
  consultations.push({
    hospitalId,
    hospital: hospital.name,
    type,
    name,
    phone,
    date,
    time,
    notes,
    createdAt: new Date().toLocaleString()
  });
  localStorage.setItem('consultations', JSON.stringify(consultations));

  closeConsultationModal();
  loadConsultations();
  updateDashboardStats();
  alert(`Consultation request submitted for ${hospital.name}.`);
});

function loadConsultations() {
  const list = document.getElementById('consultationList');
  if (!list) return;
  const consultations = JSON.parse(localStorage.getItem('consultations')) || [];
  list.innerHTML = '';

  if (!consultations.length) {
    list.innerHTML = '<p class="text-muted" style="padding:20px 0;">No dermatologist consultations requested yet.</p>';
    return;
  }

  consultations.slice().reverse().forEach(c => {
    const div = document.createElement('div');
    div.className = 'consultation-card';
    div.innerHTML = `
      <div class="consultation-card-top">
        <div><strong>${escapeHtml(c.hospital)}</strong><div class="consultation-meta">${escapeHtml(c.date)} at ${escapeHtml(c.time)} • ${escapeHtml(c.name)}</div></div>
        <span class="consultation-badge">${escapeHtml(c.type)}</span>
      </div>
      ${c.notes ? `<div class="consultation-meta">${escapeHtml(c.notes)}</div>` : ''}`;
    list.appendChild(div);
  });
}

// Restore the last detected location for a faster repeat visit.
(function restoreSavedLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem('dermamindLocation') || 'null');
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
      detectedLocation = saved;
    }
  } catch (_) {}
})();

if (detectedLocation) {
  // The hospital list is loaded when the user opens the Hospitals section.
}

/* ========================================
   APPOINTMENTS
   ======================================== */

function openBooking(hospitalId) {
  if (!requireCompletedProfile('book an appointment')) return;
  const hospital = nearbyHospitals.find(h => h.id === hospitalId);
  if (hospital) populateHospitalSelect(hospital);
  document.querySelector('[data-section="appointments"]').click();
}

appointmentForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!requireCompletedProfile('book an appointment')) return;
  
  const hospitalId = document.getElementById('hospitalSelect').value;
  const selectedHospital = nearbyHospitals.find(h => h.id === hospitalId);
  const hospital = selectedHospital ? selectedHospital.name : hospitalId;
  const pname = document.getElementById('pname').value.trim();
  const date = document.getElementById('date').value;
  const time = document.getElementById('time').value;
  const phone = document.getElementById('phone').value.trim();
  const notes = document.getElementById('notes').value.trim();

  if (!hospital || !pname || !date || !time || !phone) {
    alert('Please fill in all required fields.');
    return;
  }

  let appointments = JSON.parse(localStorage.getItem('appointments')) || [];
  appointments.push({ hospital, name: pname, date, time, phone, notes, createdAt: new Date().toLocaleString() });

  localStorage.setItem('appointments', JSON.stringify(appointments));
  
  appointmentForm.reset();
  alert('Appointment booked successfully!');
  loadAppointments();
  updateDashboardStats();
});

function loadAppointments() {
  let apps = JSON.parse(localStorage.getItem('appointments')) || [];
  appointmentList.innerHTML = '';

  if (apps.length === 0) {
    appointmentList.innerHTML = '<p class="text-muted" style="padding:40px;text-align:center;">No appointments scheduled.</p>';
    return;
  }

  apps.reverse().forEach(a => {
    const div = document.createElement('div');
    div.className = 'appointment-card';
    div.innerHTML = `
      <div class="appointment-icon"></div>
      <div class="appointment-details">
        <h4>${a.hospital}</h4>
        <p>${a.date} at ${a.time}</p>
        <p>${a.name} | ${a.phone}</p>
        ${a.notes ? `<p style="font-style:italic;margin-top:4px;">"${a.notes}"</p>` : ''}
      </div>
    `;
    appointmentList.appendChild(div);
  });
}

loadAppointments();
loadConsultations();

/* ========================================
   MOBILE NAVIGATION
   ======================================== */

const mobileNavToggle = document.getElementById('mobileNavToggle');
const mobileNavOverlay = document.getElementById('mobileNavOverlay');
const sidebar = document.querySelector('.sidebar');

function closeMobileNav() {
  sidebar?.classList.remove('mobile-open');
  mobileNavOverlay?.classList.remove('active');
  mobileNavToggle?.setAttribute('aria-expanded', 'false');
}

mobileNavToggle?.addEventListener('click', () => {
  const open = sidebar.classList.toggle('mobile-open');
  mobileNavOverlay?.classList.toggle('active', open);
  mobileNavToggle.setAttribute('aria-expanded', String(open));
});
mobileNavOverlay?.addEventListener('click', closeMobileNav);
document.querySelectorAll('.navBtn').forEach(btn => btn.addEventListener('click', closeMobileNav));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMobileNav(); closeConsultationModal(); } });

/* ========================================
   CHATBOT - Enhanced with Comprehensive Q&A
   ======================================== */

const chatToggle = document.getElementById('chatToggle');
const chatbot = document.getElementById('chatbot');

chatToggle.addEventListener('click', () => {
  chatbot.classList.toggle('active');
  chatToggle.classList.toggle('active');
});

function addMessage(text, type) {
  const div = document.createElement('div');
  div.className = `message ${type}`;
  div.innerHTML = `${text}<div style="font-size:0.625rem;opacity:0.7;margin-top:4px;">${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Enhanced chatbot responses
const botResponses = {
  // Greetings
  'greeting': [
    "Hello! I'm Dermamind, your AI health assistant. How can I help you today?",
    "Hi there! I can answer questions about skin health and cancer prevention. What would you like to know?",
    "Welcome! Feel free to ask me about skin cancer, sun protection, or skin health."
  ],
  
  // Skin Cancer Basics
  'what_is_cancer': "Skin cancer is an abnormal growth of skin cells. It's usually caused by UV radiation from the sun or tanning beds. The three main types are basal cell carcinoma, squamous cell carcinoma, and melanoma.",
  
  'melanoma': "Melanoma is the most serious type of skin cancer. It develops in melanocytes (pigment-producing cells). Key warning signs include: asymmetry, irregular borders, multiple colors, diameter >6mm, and evolving changes (ABCDE rule).",
  
  'basal_cell': "Basal cell carcinoma is the most common type of skin cancer. It often appears as a pearly bump or pinkish patch. While rarely fatal, it can cause significant tissue damage if untreated.",
  
  'squamous_cell': "Squamous cell carcinoma is the second most common skin cancer. It may appear as a red, scaly patch or firm bump. Early treatment is highly effective.",
  
  // Symptoms & Signs
  'symptoms': "Common signs of skin cancer include: new moles or growths, changes in existing moles, unusual patches or spots, non-healing sores, or bleeding bumps. The ABCDE rule helps identify melanoma: Asymmetry, Border irregularity, Color variation, Diameter >6mm, Evolving changes.",
  
  'abcde': "The ABCDE rule helps identify melanoma:\n\n- A - Asymmetry: One half doesn't match the other\n- B - Border: Edges are ragged, notched, or blurred\n- C - Color: Color is not uniform (shades of brown, black, tan)\n- D - Diameter: Larger than 6mm (pencil eraser)\n- E - Evolving: Changing in size, shape, or color",
  
  'when_to_see': "You should see a dermatologist if you notice: any new or changing moles, spots that itch or bleed, unusual skin growths, non-healing sores, or any of the ABCDE warning signs.",
  
  // Prevention
  'prevent': "To prevent skin cancer:\n\n- Use sunscreen SPF 30+ daily\n- Reapply every 2 hours outdoors\n- Wear protective clothing & hats\n- Avoid peak sun hours (10am-4pm)\n- No tanning beds\n- Regular skin self-exams\n- Annual dermatology checkups",
  
  'sunscreen': "Use a broad-spectrum sunscreen with SPF 30 or higher. Apply 15-30 minutes before sun exposure and reapply every 2 hours, or after swimming or sweating. Don't forget often-missed areas like ears, neck, and feet.",
  
  'spf': "SPF (Sun Protection Factor) indicates how well a sunscreen protects against UVB rays. SPF 30 blocks about 97% of UVB rays, SPF 50 blocks about 98%. Higher SPFs provide marginally better protection but need the same reapplication frequency.",
  
  // Risk Factors
  'risk_factors': "Risk factors for skin cancer include: fair skin, light eyes/blonde/red hair, many moles, family history, history of sunburns, indoor tanning, weak immune system, and excessive UV exposure.",
  
  'who_gets': "Anyone can get skin cancer, but higher risk groups include: people with fair skin, those with many moles, people with a family history, and those who use tanning beds.",
  
  // Treatment
  'treatment': "Skin cancer treatment depends on the type, size, and location. Options include: surgical excision, Mohs surgery, cryotherapy, radiation therapy, topical medications, and immunotherapy. Early detection leads to better outcomes.",
  
  'cure_rate': "When detected early, skin cancer has excellent cure rates:\n\n- Basal cell carcinoma: ~99%\n- Squamous cell carcinoma: ~95%\n- Melanoma: ~99% (if caught early)",
  
  // Self Examination
  'self_exam': "Perform skin self-exams monthly:\n\n1. Examine your body front and back in a mirror\n2. Check underarms, forearms, palms\n3. Look at legs, feet, between toes\n4. Use a hand mirror for back/neck\n5. Note any new or changing moles\n6. Take photos to track changes",
  
  'how_to_check': "For self-exams, use the ABCDE rule:\n\n- A - Asymmetry\n- B - Border irregularity\n- C - Color variation\n- D - Diameter >6mm\n- E - Evolving changes\n\nAlso watch for: itching, bleeding, or non-healing sores.",
  
  // Types of Moles
  'moles': "Most moles are benign (non-cancerous). They can be flat or raised, various colors, and appear anywhere on the body. While most are harmless, any new or changing moles should be checked by a dermatologist.",
  
  'atypical_moles': "Atypical moles (dysplastic nevi) have irregular features and may resemble melanoma. They run in families and indicate higher melanoma risk. Regular monitoring and dermatologist checkups are recommended.",
  
  // Sun Protection
  'uv_rays': "UVA rays (aging) penetrate deep into skin, causing wrinkles and aging. UVB rays (burning) affect the surface, causing sunburn. Both can cause skin cancer. Use broad-spectrum sunscreen for protection.",
  
  'sunburn': "Sunburn is skin damage from UV radiation. It increases skin cancer risk and accelerates aging. Treat with aloe vera, cool compresses, hydration, and avoid further sun exposure. Never pop blisters.",
  
  // General Health
  'vitamin_d': "You can get vitamin D through diet (fatty fish, fortified foods) or supplements. You don't need sunburn for vitamin D - just a few minutes of sun exposure with sunscreen is enough.",
  
  'tanning_beds': "Tanning beds are dangerous and should be avoided. They emit concentrated UV radiation that significantly increases skin cancer risk. There is no 'safe' tan from indoor tanning.",
  
  // Follow-up
  'follow_up': "After skin cancer treatment, follow-up is important. You'll need regular skin exams (every 3-12 months depending on your case), monthly self-exams, and sun protection. Report any new or changing spots to your dermatologist.",
  
  // Default responses
  'default': [
    "I'm here to help with skin health questions. Try asking about skin cancer, sun protection, or how to check your skin.",
    "That's a great question! I can help with skin cancer prevention, symptoms, or treatment. What would you like to know?",
    "I can provide information about skin cancer, sun safety, and skin health. Feel free to ask!",
    "For specific medical advice, please consult a dermatologist. But I'm happy to answer general questions about skin health!"
  ]
};

// Comprehensive keyword matching
function getSimulatedResponse(msg) {
  msg = msg.toLowerCase();
  
  // Greetings
  if (msg.includes('hello') || msg.includes('hi') || msg.includes('hey') || msg.includes('greetings')) {
    return getRandomResponse(botResponses.greeting);
  }
  
  // Skin cancer types
  if (msg.includes('basal cell')) {
    return botResponses.basal_cell;
  }
  if (msg.includes('squamous cell')) {
    return botResponses.squamous_cell;
  }
  if (msg.includes('melanoma')) {
    return botResponses.melanoma;
  }
  if (msg.includes('skin cancer') || msg.includes('skin carcinoma')) {
    return botResponses.what_is_cancer;
  }
  
  // Symptoms & Signs
  if (msg.includes('symptom') || msg.includes('sign') || msg.includes('warning sign')) {
    return botResponses.symptoms;
  }
  if (msg.includes('abcde') || msg.includes('check mole') || msg.includes('identify') || msg.includes('detect')) {
    return botResponses.abcde;
  }
  if (msg.includes('when to see') || msg.includes('should i see') || msg.includes('doctor') || msg.includes('dermatologist')) {
    return botResponses.when_to_see;
  }
  
  // Prevention
  if (msg.includes('prevent') || msg.includes('prevention') || msg.includes('avoid')) {
    return botResponses.prevent;
  }
  if (msg.includes('sunscreen') || msg.includes('sun screen') || msg.includes('sunblock')) {
    return botResponses.sunscreen;
  }
  if (msg.includes('spf') || msg.includes('sun protection factor')) {
    return botResponses.spf;
  }
  if (msg.includes('protect') || msg.includes('sun') || msg.includes('uv') || msg.includes('sunburn')) {
    return botResponses.prevent;
  }
  
  // Risk Factors
  if (msg.includes('risk') || msg.includes('who gets') || msg.includes('chance')) {
    return botResponses.risk_factors;
  }
  
  // Treatment
  if (msg.includes('treat') || msg.includes('treatment') || msg.includes('cure') || msg.includes('remove')) {
    return botResponses.treatment;
  }
  if (msg.includes('survival') || msg.includes('cure rate') || msg.includes('prognosis')) {
    return botResponses.cure_rate;
  }
  
  // Self Examination
  if (msg.includes('self exam') || msg.includes('self-exam') || msg.includes('check skin')) {
    return botResponses.self_exam;
  }
  if (msg.includes('how to check') || msg.includes('examine')) {
    return botResponses.how_to_check;
  }
  
  // Moles
  if (msg.includes('mole') || msg.includes('nevus') || msg.includes('moles')) {
    return botResponses.moles;
  }
  if (msg.includes('atypical') || msg.includes('dysplastic')) {
    return botResponses.atypical_moles;
  }
  
  // Sun & UV
  if (msg.includes('uva') || msg.includes('uvb') || msg.includes('uv ray')) {
    return botResponses.uv_rays;
  }
  
  // Vitamin D
  if (msg.includes('vitamin d') || msg.includes('vitamin')) {
    return botResponses.vitamin_d;
  }
  
  // Tanning
  if (msg.includes('tanning') || msg.includes('tan') || msg.includes('tanned')) {
    return botResponses.tanning_beds;
  }
  
  // Follow-up
  if (msg.includes('follow up') || msg.includes('after treatment') || msg.includes('recovery')) {
    return botResponses.follow_up;
  }
  
  // Thank you
  if (msg.includes('thank') || msg.includes('thanks')) {
    return "You're welcome! Stay sun-safe!";
  }
  
  // Goodbye
  if (msg.includes('bye') || msg.includes('goodbye') || msg.includes('see you')) {
    return "Goodbye! Remember to protect your skin!";
  }
  
  // Default response
  return getRandomResponse(botResponses.default);
}

function getRandomResponse(responses) {
  return responses[Math.floor(Math.random() * responses.length)];
}

sendChat.addEventListener('click', async () => {
  if (!requireCompletedProfile('use the Dermamind assistant')) return;
  const msg = chatText.value.trim();
  if (!msg) return;

  addMessage(msg, 'user');
  chatText.value = '';

  const typingDiv = document.createElement('div');
  typingDiv.className = 'message bot';
  typingDiv.innerHTML = '<em>Typing...</em>';
  chatMessages.appendChild(typingDiv);

  try {
    let reply;
    if (CHATBOT_SIMULATION_MODE) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      reply = getSimulatedResponse(msg);
    } else {
      const res = await fetch('http://localhost:5000/chatbot-message', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({message:msg}) });
      const data = await res.json();
      reply = data.reply;
    }
    typingDiv.remove();
    addMessage(reply, 'bot');
  } catch (error) {
    typingDiv.remove();
    addMessage('Sorry, I could not process your request.', 'bot');
  }
});

chatText.addEventListener('keypress', (e) => { if(e.key==='Enter') sendChat.click(); });

/* ========================================
   DOWNLOAD REPORT
   ======================================== */

document.getElementById('downloadReport').addEventListener('click', () => {
  const risk = riskResult.innerText;
  const conf = confidence.innerText;
  const exp = explanation.innerText;
  const benign = document.getElementById('benignValue').textContent;
  const malignant = document.getElementById('malignantValue').textContent;
  const precision = document.getElementById('precision').textContent;
  const recall = document.getElementById('recall').textContent;
  const f1 = document.getElementById('f1score').textContent;
  const accuracy = document.getElementById('accuracy').textContent;
  const topClass = document.getElementById('topClass')?.textContent || 'Unknown';
  const date = new Date().toLocaleString();

  const report = `DERMAMIND - SKIN SCREENING REPORT
==================================

Date: ${date}

CLASSIFICATION
Benign: ${benign}
Malignant: ${malignant}

RISK ASSESSMENT
Risk Level: ${risk}
Confidence: ${conf}

MODEL DETAILS
Top predicted lesion: ${topClass}
Validation accuracy (model card): ${precision}
Malignant probability for this scan: ${recall}
Model output: ${f1}
Inference: ${accuracy}

EXPLANATION
${exp}

Please consult a dermatologist for professional advice.
© Dermamind`;

  const blob = new Blob([report], {type:'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Dermamind_Report_${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  
  alert('Report downloaded successfully!');
});

/* ========================================
   MODEL PERFORMANCE PAGE (Phase 8 / Phase 28)
   ======================================== */

function pct(x) { return (x * 100).toFixed(1) + '%'; }

function renderModelPerformance() {
  const data = (typeof MODEL_PERFORMANCE !== 'undefined') ? MODEL_PERFORMANCE : null;
  if (!data) return;

  const statsEl = document.getElementById('mpOverallStats');
  if (statsEl) {
    const stats = [
      ['Accuracy', pct(data.overall.accuracy), `${data.overall.correct}/${data.overall.total} correct`],
      ['Macro F1', pct(data.overall.macroF1), 'unweighted across classes'],
      ['Weighted F1', pct(data.overall.weightedF1), 'weighted by class size'],
      ['Macro ROC-AUC', data.overall.macroAucOneVsRest.toFixed(3), 'one-vs-rest average']
    ];
    statsEl.innerHTML = stats.map(([label, value, sub]) => `
      <div class="mp-stat">
        <div class="mp-stat-value">${value}</div>
        <div class="mp-stat-label">${label}<br>${sub}</div>
      </div>
    `).join('');
  }

  const testSetEl = document.getElementById('mpTestSetInfo');
  if (testSetEl) {
    testSetEl.textContent = `Tested on ${data.testSet.totalImages} real, labeled images from ${data.testSet.source}. ${data.testSet.note}`;
  }

  const LOW_SUPPORT_THRESHOLD = 15; // below this, treat per-class numbers as illustrative only
  const tbody = document.getElementById('mpPerClassBody');
  if (tbody) {
    tbody.innerHTML = data.perClass.map(c => {
      const lowSupport = c.support < LOW_SUPPORT_THRESHOLD;
      return `
        <tr>
          <td>${c.label}${lowSupport ? ' *' : ''}</td>
          <td class="${lowSupport ? 'mp-low-support' : ''}">${c.support}</td>
          <td>${pct(c.precision)}</td>
          <td>${pct(c.recall)}</td>
          <td>${pct(c.f1)}</td>
          <td>${pct(c.specificity)}</td>
          <td>${c.auc.toFixed(3)}</td>
        </tr>
      `;
    }).join('') + `<tr><td colspan="7" class="mp-low-support" style="text-align:left;">* Fewer than ${LOW_SUPPORT_THRESHOLD} test images — treat this row's numbers as illustrative, not statistically reliable.</td></tr>`;
  }

  const cmEl = document.getElementById('mpConfusionMatrix');
  if (cmEl) {
    const labels = data.confusionMatrix.labels;
    const matrix = data.confusionMatrix.matrix;
    let html = '<table class="mp-table"><thead><tr><th>True \\ Predicted</th>' + labels.map(l => `<th>${l}</th>`).join('') + '</tr></thead><tbody>';
    matrix.forEach((row, i) => {
      html += '<tr>' + `<th style="text-align:left;">${labels[i]}</th>` + row.map((v, j) =>
        `<td class="${i === j ? '' : ''}"${i === j ? ' style="background:#f0fdf4;font-weight:700;"' : ''}>${v}</td>`
      ).join('') + '</tr>';
    });
    html += '</tbody></table>';
    cmEl.innerHTML = html;
  }

  const limitationsEl = document.getElementById('mpLimitations');
  if (limitationsEl) {
    limitationsEl.innerHTML = data.limitations.map(l => `<li>${l}</li>`).join('');
  }

  const genEl = document.getElementById('mpGeneratedAt');
  if (genEl) {
    const d = new Date(data.generatedAt);
    genEl.textContent = `Model: ${data.model} · Evaluated: ${d.toLocaleDateString()}`;
  }
}

renderModelPerformance();
