/* ========================================
   DERMAMIND - Analysis Routes (Phase 3: image storage)
   POST   /analyses            create an analysis record (multipart: image + fields)
   GET    /analyses            list the caller's own analyses (metadata only)
   GET    /analyses/:id        one analysis' metadata
   GET    /analyses/:id/image  stream the original image (auth-gated)
   GET    /analyses/:id/heatmap stream the XAI heatmap (auth-gated; Phase 7 fills this in)
   DELETE /analyses/:id        delete a record and its files

   Every route requires auth and every query is scoped to req.userId, so a
   user can only ever see/modify their own analyses.
   ======================================== */

const express = require('express');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/database');
const requireAuth = require('../middleware/require-auth');
const { newId } = require('../utils/auth-utils');
const { analysisDir, extForMime, relativePath, absolutePath, deleteAnalysisFiles } = require('../utils/image-storage');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Assigns the analysis ID up front so multer's disk storage can use it to
// build the per-analysis directory before the route handler runs.
function assignAnalysisId(req, _res, next) {
  req.analysisId = newId();
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, _file, cb) {
      const dir = analysisDir(req.userId, req.analysisId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const ext = extForMime(file.mimetype);
      const base = file.fieldname === 'heatmap' ? 'heatmap' : 'original';
      cb(null, `${base}.${ext || 'bin'}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB, matches the existing client-side limit
  fileFilter(_req, file, cb) {
    if (!extForMime(file.mimetype)) {
      return cb(new Error('Unsupported image type. Please upload a JPEG, PNG, or WEBP image.'));
    }
    cb(null, true);
  }
});
const uploadFields = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'heatmap', maxCount: 1 }]);

function toApiShape(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    hasOriginalImage: Boolean(row.original_image_path),
    hasHeatmap: Boolean(row.heatmap_image_path),
    predictedClass: row.predicted_class,
    confidence: row.confidence,
    classProbabilities: safeParse(row.class_probabilities),
    imageQualityStatus: row.image_quality_status,
    imageValidationMessage: row.image_validation_message,
    userDescription: safeParse(row.user_description),
    modelName: row.model_name,
    modelVersion: row.model_version,
    screeningResult: safeParse(row.screening_result),
    disclaimerAcknowledged: Boolean(row.disclaimer_acknowledged)
  };
}

function safeParse(json) {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

router.post('/', requireAuth, assignAnalysisId, uploadFields, asyncHandler(async (req, res) => {
  const imageFile = req.files?.image?.[0];
  const heatmapFile = req.files?.heatmap?.[0];

  if (!imageFile) {
    return res.status(400).json({ error: 'An image file is required.' });
  }

  const body = req.body || {};
  const id = req.analysisId;
  const createdAt = new Date().toISOString();
  const originalImagePath = relativePath(req.userId, id, imageFile.filename);
  const heatmapImagePath = heatmapFile ? relativePath(req.userId, id, heatmapFile.filename) : null;

  db.prepare(`
    INSERT INTO analyses (
      id, user_id, created_at, original_image_path, heatmap_image_path, predicted_class, confidence,
      class_probabilities, image_quality_status, image_validation_message,
      user_description, model_name, model_version, screening_result, disclaimer_acknowledged
    ) VALUES (
      @id, @user_id, @created_at, @original_image_path, @heatmap_image_path, @predicted_class, @confidence,
      @class_probabilities, @image_quality_status, @image_validation_message,
      @user_description, @model_name, @model_version, @screening_result, @disclaimer_acknowledged
    )
  `).run({
    id,
    user_id: req.userId,
    created_at: createdAt,
    original_image_path: originalImagePath,
    heatmap_image_path: heatmapImagePath,
    predicted_class: body.predictedClass || null,
    confidence: body.confidence !== undefined ? Number(body.confidence) : null,
    class_probabilities: body.classProbabilities || null,
    image_quality_status: body.imageQualityStatus || null,
    image_validation_message: body.imageValidationMessage || null,
    user_description: body.userDescription || null,
    model_name: body.modelName || null,
    model_version: body.modelVersion || null,
    screening_result: body.screeningResult || null,
    disclaimer_acknowledged: body.disclaimerAcknowledged === 'true' || body.disclaimerAcknowledged === true ? 1 : 0
  });

  const row = db.prepare('SELECT * FROM analyses WHERE id = ? AND user_id = ?').get(id, req.userId);
  res.status(201).json({ analysis: toApiShape(row) });
}));

// Multer errors (bad file type, too large) reach here via next(err) from the
// fileFilter/limits above; convert them to clean JSON instead of a 500 stack trace.
router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError || err?.message?.includes('Unsupported image type')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const rows = db.prepare('SELECT * FROM analyses WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
  res.json({ analyses: rows.map(toApiShape) });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM analyses WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!row) return res.status(404).json({ error: 'Analysis not found.' });
  res.json({ analysis: toApiShape(row) });
}));

router.get('/:id/image', requireAuth, asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT original_image_path AS img_path FROM analyses WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId);
  if (!row || !row.img_path) return res.status(404).json({ error: 'Image not found.' });
  const filePath = absolutePath(row.img_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Image not found.' });
  res.sendFile(filePath);
}));

router.get('/:id/heatmap', requireAuth, asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT heatmap_image_path AS img_path FROM analyses WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId);
  if (!row || !row.img_path) return res.status(404).json({ error: 'Heatmap not available for this analysis.' });
  const filePath = absolutePath(row.img_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Heatmap not available for this analysis.' });
  res.sendFile(filePath);
}));

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT id FROM analyses WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!row) return res.status(404).json({ error: 'Analysis not found.' });
  db.prepare('DELETE FROM analyses WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  deleteAnalysisFiles(req.userId, req.params.id);
  res.json({ deleted: true });
}));

module.exports = router;
