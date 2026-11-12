/* ========================================
   DERMAMIND - Explainable AI (Phase 7)
   ========================================
   WHY OCCLUSION SENSITIVITY, NOT GRAD-CAM:

   Grad-CAM needs gradients of the output w.r.t. an intermediate
   convolutional feature map, obtained via a backward pass. The skin-lesion
   model here runs as a standard inference-only ONNX graph via ONNX Runtime
   Web (through @huggingface/transformers) — it was exported for forward
   inference only, has no spatial conv feature maps (it's a ViT, not a
   CNN), and does not expose a backward/gradient graph. Running true
   Grad-CAM against it isn't just harder — it isn't something this ONNX
   export supports at all.

   Occlusion sensitivity (Zeiler & Fergus, 2014) is the technically
   appropriate substitute here: it needs only repeated FORWARD passes
   through the existing classifier — no gradients, no architecture-specific
   internals — so it works with any black-box image classifier, including
   this one, exactly as exported. The method: systematically hide small
   regions of the image, re-run the classifier on each occluded version,
   and record how much the predicted class's probability drops. Regions
   whose removal drops confidence the most are the regions the model relied
   on most for that prediction.

   TRADE-OFF: this requires one forward pass per grid cell (see GRID_SIZE
   below), so it's slower and coarser than Grad-CAM would be on a CNN.
   That's a real, disclosed limitation — not hidden from the user.
   ======================================== */

const XAI = (function () {
  const WORKING_SIZE = 224; // occlusion grid + scoring happen at this resolution
  const GRID_SIZE = 5;      // 5x5 = 25 forward passes + 1 baseline; faster + less UI freeze than 6x6
  const OCCLUSION_COLOR = '128,128,128'; // neutral gray patch, standard choice for occlusion sensitivity
  // Brief yield between passes so the main thread can paint progress + stay responsive
  const YIELD_MS = 12;

  function loadImageElement(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load image for XAI.'));
      img.src = source;
    });
  }

  function drawWorkingCanvas(img) {
    const canvas = document.createElement('canvas');
    canvas.width = WORKING_SIZE;
    canvas.height = WORKING_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, WORKING_SIZE, WORKING_SIZE);
    return canvas;
  }

  function cloneCanvasWithOcclusion(sourceCanvas, cellIndex, gridSize) {
    const canvas = document.createElement('canvas');
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);

    const cellW = canvas.width / gridSize;
    const cellH = canvas.height / gridSize;
    const row = Math.floor(cellIndex / gridSize);
    const col = cellIndex % gridSize;

    ctx.fillStyle = `rgb(${OCCLUSION_COLOR})`;
    ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
    return canvas;
  }

  async function scoreForLabel(classifier, canvas, targetKey, normalizeLabel, topK) {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const predictions = await classifier(dataUrl, { top_k: topK });
    const match = predictions.find(p => normalizeLabel(p.label) === targetKey);
    return match ? Number(match.score) || 0 : 0;
  }

  // Jet-style colormap: t in [0,1] -> [r,g,b,a]. Alpha scales with t so
  // low-importance regions stay transparent (don't obscure the photo).
  function heatColor(t) {
    let r, g, b;
    if (t < 0.25) { r = 0; g = Math.round(4 * t * 255); b = 255; }
    else if (t < 0.5) { r = 0; g = 255; b = Math.round(255 - 4 * (t - 0.25) * 255); }
    else if (t < 0.75) { r = Math.round(4 * (t - 0.5) * 255); g = 255; b = 0; }
    else { r = 255; g = Math.round(255 - 4 * (t - 0.75) * 255); b = 0; }
    const a = Math.round(t * 200);
    return [r, g, b, a];
  }

  function buildHeatmapCanvas(importanceGrid, gridSize, outWidth, outHeight) {
    // Render the low-res importance grid onto a small canvas, then let the
    // browser's own image smoothing upscale it — a simple, standard way to
    // get a smooth-looking heatmap from a coarse grid.
    const small = document.createElement('canvas');
    small.width = gridSize;
    small.height = gridSize;
    const sctx = small.getContext('2d');
    const imageData = sctx.createImageData(gridSize, gridSize);
    for (let i = 0; i < importanceGrid.length; i++) {
      const [r, g, b, a] = heatColor(importanceGrid[i]);
      imageData.data[i * 4] = r;
      imageData.data[i * 4 + 1] = g;
      imageData.data[i * 4 + 2] = b;
      imageData.data[i * 4 + 3] = a;
    }
    sctx.putImageData(imageData, 0, 0);

    const out = document.createElement('canvas');
    out.width = outWidth;
    out.height = outHeight;
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(small, 0, 0, outWidth, outHeight);
    return out;
  }

  /**
   * Generates an occlusion-sensitivity heatmap explaining `classifier`'s
   * prediction of `targetKey` for `imageSource` (a File, Blob, or URL).
   *
   * `normalizeLabel` must map a raw model label string to the same short
   * key used elsewhere in the app (e.g. normalizeModelLabel), so the score
   * for the correct class is tracked across every occluded pass.
   *
   * Returns { heatmapDataUrl, overlayDataUrl, originalDataUrl, baselineScore, gridSize }.
   */
  async function generateOcclusionHeatmap(classifier, imageSource, targetKey, normalizeLabel, onProgress, topK = 7) {
    const objectUrl = imageSource instanceof Blob ? URL.createObjectURL(imageSource) : imageSource;
    try {
      const img = await loadImageElement(objectUrl);
      const workingCanvas = drawWorkingCanvas(img);

      const baselineScore = await scoreForLabel(classifier, workingCanvas, targetKey, normalizeLabel, topK);

      const totalCells = GRID_SIZE * GRID_SIZE;
      const drops = new Array(totalCells).fill(0);
      for (let i = 0; i < totalCells; i++) {
        const occluded = cloneCanvasWithOcclusion(workingCanvas, i, GRID_SIZE);
        const occludedScore = await scoreForLabel(classifier, occluded, targetKey, normalizeLabel, topK);
        drops[i] = Math.max(0, baselineScore - occludedScore);
        if (typeof onProgress === 'function') onProgress(i + 1, totalCells);
        // Yield so the browser can update the progress text and remain responsive
        if (YIELD_MS > 0) await new Promise(r => setTimeout(r, YIELD_MS));
      }

      const maxDrop = Math.max(...drops, 1e-6);
      const importance = drops.map(d => d / maxDrop);

      // Render outputs at the original image's native resolution.
      const outW = img.naturalWidth || WORKING_SIZE;
      const outH = img.naturalHeight || WORKING_SIZE;

      const heatmapCanvas = buildHeatmapCanvas(importance, GRID_SIZE, outW, outH);

      const originalCanvas = document.createElement('canvas');
      originalCanvas.width = outW;
      originalCanvas.height = outH;
      originalCanvas.getContext('2d').drawImage(img, 0, 0, outW, outH);

      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = outW;
      overlayCanvas.height = outH;
      const octx = overlayCanvas.getContext('2d');
      octx.drawImage(originalCanvas, 0, 0);
      octx.drawImage(heatmapCanvas, 0, 0);

      return {
        heatmapDataUrl: heatmapCanvas.toDataURL('image/png'),
        overlayDataUrl: overlayCanvas.toDataURL('image/jpeg', 0.92),
        originalDataUrl: originalCanvas.toDataURL('image/jpeg', 0.92),
        baselineScore,
        gridSize: GRID_SIZE
      };
    } finally {
      if (imageSource instanceof Blob) URL.revokeObjectURL(objectUrl);
    }
  }

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then(r => r.blob());
  }

  // Composites an already-generated heatmap image (with alpha baked in,
  // transparent where unimportant) over the original photo. Used to
  // reconstruct an "Overlay" view in Scan History, where only the original
  // and the pure heatmap are stored server-side (not a separate overlay file).
  function composeOverlay(originalUrl, heatmapUrl) {
    return new Promise((resolve, reject) => {
      const orig = new Image();
      const heat = new Image();
      let loaded = 0;
      const onBothLoaded = () => {
        const canvas = document.createElement('canvas');
        canvas.width = orig.naturalWidth;
        canvas.height = orig.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(orig, 0, 0, canvas.width, canvas.height);
        ctx.drawImage(heat, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      orig.onload = () => { if (++loaded === 2) onBothLoaded(); };
      heat.onload = () => { if (++loaded === 2) onBothLoaded(); };
      orig.onerror = reject;
      heat.onerror = reject;
      orig.src = originalUrl;
      heat.src = heatmapUrl;
    });
  }

  return { generateOcclusionHeatmap, dataUrlToBlob, composeOverlay, GRID_SIZE };
})();