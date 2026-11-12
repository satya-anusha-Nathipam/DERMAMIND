/* ========================================
   DERMAMIND - API client
   Thin wrapper around the DERMAMIND backend's auth + profile endpoints.

   *** THIS IS THE ONE PLACE TO EDIT FOR LOCAL TESTING ***
   Change the URL below to 'http://localhost:5050' when running the
   backend on your own machine, then change it back before deploying.
   Both home.html (signup/login) and index.html (everything else) load
   this file first and share this single constant, so editing it here
   is the only change needed -- no need to also edit script.js.
   ======================================== */

const DERMAMIND_API_URL = 'http://localhost:5050';

const DermaMindAPI = (function () {
  const TOKEN_KEY = 'dermamindToken';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }
  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
  }
  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  async function request(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetch(`${DERMAMIND_API_URL}${path}`, { ...options, headers });
    } catch (networkError) {
      throw new Error('Could not reach the DERMAMIND server. Check your internet connection and try again.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (HTTP ${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function signup(name, email, password) {
    const data = await request('/auth/signup', { method: 'POST', body: JSON.stringify({ name, email, password }) });
    setToken(data.token);
    return data.user;
  }

  async function login(email, password) {
    const data = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setToken(data.token);
    return data.user;
  }

  function logout() {
    clearToken();
  }

  async function me() {
    const data = await request('/auth/me', { method: 'GET' });
    return data.user;
  }

  async function getProfile() {
    const data = await request('/profile', { method: 'GET' });
    return data.profile;
  }

  async function saveProfile(profile) {
    const data = await request('/profile', { method: 'PUT', body: JSON.stringify(profile) });
    return data.profile;
  }

  // --- Analyses (Phase 3: image storage) ---

  async function createAnalysis(imageFile, fields = {}, heatmapFile = null) {
    const formData = new FormData();
    formData.append('image', imageFile);
    if (heatmapFile) formData.append('heatmap', heatmapFile, 'heatmap.png');
    Object.entries(fields).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    });

    const token = getToken();
    let response;
    try {
      response = await fetch(`${DERMAMIND_API_URL}/analyses`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData
      });
    } catch (networkError) {
      throw new Error('Could not reach the DERMAMIND server to save this scan.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status})`);
    return data.analysis;
  }

  async function listAnalyses() {
    const data = await request('/analyses', { method: 'GET' });
    return data.analyses;
  }

  async function getAnalysis(id) {
    const data = await request(`/analyses/${encodeURIComponent(id)}`, { method: 'GET' });
    return data.analysis;
  }

  async function deleteAnalysis(id) {
    return request(`/analyses/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // Images are behind auth, so <img src="..."> can't be pointed at the API
  // directly. Fetch with the auth header and hand back a blob: URL instead.
  async function getAnalysisImageUrl(id, kind = 'image') {
    const token = getToken();
    const response = await fetch(`${DERMAMIND_API_URL}/analyses/${encodeURIComponent(id)}/${kind}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  return {
    getToken, setToken, clearToken, signup, login, logout, me, getProfile, saveProfile,
    createAnalysis, listAnalyses, getAnalysis, deleteAnalysis, getAnalysisImageUrl
  };
})();
