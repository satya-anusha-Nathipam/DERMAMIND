/* ========================================
   DERMAMIND - requireAuth middleware
   Verifies the Bearer JWT and attaches req.userId.
   Every route that touches a specific user's data must use this so
   User A can never read or write User B's records.
   ======================================== */

const { verifyToken } = require('../utils/auth-utils');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

module.exports = requireAuth;
