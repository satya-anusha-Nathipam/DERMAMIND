/* ========================================
   DERMAMIND - Image Storage Helpers
   ========================================
   Images are stored on disk, scoped by user and analysis ID:
     UPLOADS_DIR/<userId>/<analysisId>/original.<ext>
     UPLOADS_DIR/<userId>/<analysisId>/heatmap.<ext>   (written in Phase 7)

   The database only ever stores the relative path, never a public URL —
   access always goes through the authenticated /analyses/:id/image and
   /analyses/:id/heatmap routes, which check ownership before streaming
   the file. There is no static file server exposing this directory.
   ======================================== */

const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

function analysisDir(userId, analysisId) {
  return path.join(UPLOADS_DIR, userId, analysisId);
}

function extForMime(mimetype) {
  return ALLOWED_MIME_TO_EXT[mimetype] || null;
}

// Relative path stored in the DB (portable across UPLOADS_DIR moves/hosts).
function relativePath(userId, analysisId, filename) {
  return path.join(userId, analysisId, filename);
}

function absolutePath(relPath) {
  const resolved = path.join(UPLOADS_DIR, relPath);
  // Defense in depth: never resolve outside UPLOADS_DIR (path traversal guard).
  if (!resolved.startsWith(path.join(UPLOADS_DIR, path.sep)) && resolved !== UPLOADS_DIR) {
    throw new Error('Invalid stored path.');
  }
  return resolved;
}

function deleteAnalysisFiles(userId, analysisId) {
  const dir = analysisDir(userId, analysisId);
  fs.rm(dir, { recursive: true, force: true }, () => {});
}

module.exports = {
  UPLOADS_DIR,
  ALLOWED_MIME_TO_EXT,
  analysisDir,
  extForMime,
  relativePath,
  absolutePath,
  deleteAnalysisFiles
};
