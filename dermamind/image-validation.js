/* ========================================
   DERMAMIND - Image Validation Layer (Phase 4)
   ========================================
   Runs BEFORE the skin-lesion classifier. Combines:
     1. Deterministic checks: file validity, resolution.
     2. Pixel-level heuristics computed on-canvas: blur (variance of the
        Laplacian — a standard, well-documented blur metric), exposure
        (mean luminance), and a skin-tone pixel-ratio heuristic (YCbCr
        range commonly used in skin-detection literature).
     3. A real general-purpose ONNX image classifier (Xenova/mobilevit-x-small,
        1000-class ImageNet labels, runs via the same @huggingface/transformers
        library already used for the skin-lesion model) as a semantic
        "is this even plausibly a close-up of skin?" filter — this is what
        catches food/animals/cars/documents/screenshots, which pixel stats
        alone cannot reliably distinguish from a lesion photo.

   IMPORTANT — these are engineering thresholds, not clinical or scientific
   cutoffs. They were chosen to be conservative (favor letting borderline
   images through as "poor" rather than hard-blocking them as "invalid")
   and should be tuned against a real sample set of user photos before
   being trusted in production. See the KNOWN LIMITATIONS note near the
   bottom of this file, especially regarding the skin-tone heuristic.
   ======================================== */

const ImageValidation = (function () {
  const GENERAL_MODEL_ID = 'Xenova/mobilevit-x-small';
  let generalClassifier = null;
  let generalClassifierPromise = null;

  // --- Tunable engineering thresholds (NOT clinical thresholds) ---
  const MIN_WIDTH = 200;
  const MIN_HEIGHT = 200;
  const BLUR_VARIANCE_MIN = 45;           // below this, image is treated as too blurry
  const DARK_LUMINANCE_MAX = 40;          // 0-255 scale; below this, "too dark"
  const BRIGHT_LUMINANCE_MIN = 235;       // 0-255 scale; above this, "too bright / overexposed"
  const SKIN_RATIO_SOFT_MIN = 0.12;       // soft signal only, see limitations note
  const IRRELEVANT_CONFIDENCE_MIN = 0.30; // general-classifier confidence needed to hard-reject

  // Substring keyword match against whatever label text the general
  // classifier returns (its labels are standard ImageNet-1k wording, e.g.
  // "golden retriever", "sports car, sport car", "cheeseburger"). This is a
  // heuristic allowlist-by-exclusion, not exhaustive — see limitations note.
  const IRRELEVANT_KEYWORDS = [
    // animals (broad net: mammal/bird/reptile/fish/insect breed names)
    'dog', 'cat', 'retriever', 'terrier', 'spaniel', 'puppy', 'kitten', 'horse', 'cow', 'sheep',
    'bird', 'parrot', 'chicken', 'hen', 'duck', 'goose', 'fish', 'shark', 'whale', 'snake',
    'lizard', 'turtle', 'frog', 'spider', 'butterfly', 'bee', 'ant', 'beetle', 'elephant', 'lion',
    'tiger', 'bear', 'monkey', 'rabbit', 'squirrel', 'fox', 'wolf', 'deer',
    // food
    'pizza', 'burger', 'hotdog', 'hot dog', 'sandwich', 'burrito', 'taco', 'pretzel', 'bagel',
    'bread', 'cake', 'ice cream', 'pasta', 'noodle', 'soup', 'salad', 'banana', 'apple', 'orange',
    'strawberry', 'pineapple', 'lemon', 'guacamole', 'pancake', 'waffle', 'coffee mug', 'wine',
    'beer', 'cheeseburger', 'mushroom', 'broccoli', 'cucumber', 'pepper', 'corn', 'egg',
    // vehicles
    'car', 'truck', 'bus', 'bicycle', 'motorcycle', 'train', 'airplane', 'boat', 'ship', 'van',
    'jeep', 'convertible', 'trailer', 'tractor',
    // documents / screens / electronics / household
    'website', 'web site', 'menu', 'book jacket', 'comic book', 'crossword', 'envelope',
    'packet', 'notebook computer', 'laptop', 'desktop computer', 'monitor', 'television',
    'keyboard', 'computer keyboard', 'cellular telephone', 'remote control', 'printer',
    'scanner', 'chair', 'table', 'sofa', 'bed', 'lamp', 'clock', 'guitar', 'piano', 'shoe',
    'sneaker', 'sandal', 'sock', 'umbrella', 'backpack', 'suitcase', 'handbag'
  ];

  async function getGeneralClassifier() {
    if (generalClassifier) return generalClassifier;
    if (generalClassifierPromise) return generalClassifierPromise;

    generalClassifierPromise = (async () => {
      const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.1');
      const classifier = await pipeline('image-classification', GENERAL_MODEL_ID, { device: 'wasm', dtype: 'q8' });
      generalClassifier = classifier;
      return classifier;
    })().catch(error => {
      generalClassifierPromise = null;
      throw error;
    });

    return generalClassifierPromise;
  }

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, objectUrl });
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('corrupt-or-unreadable')); };
      img.src = objectUrl;
    });
  }

  // Downscales onto a canvas and computes blur (variance of Laplacian),
  // mean luminance, and skin-tone pixel ratio in a single pass.
  function computePixelStats(img) {
    const maxDim = 220; // small canvas keeps this fast; enough resolution for these stats
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    const gray = new Float32Array(w * h);
    let luminanceSum = 0;
    let skinPixels = 0;
    const totalPixels = w * h;

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[p] = y;
      luminanceSum += y;

      // YCbCr skin-tone range (approximate; see limitations note below).
      // Deliberately no luminance floor here — testing showed a y>60-style
      // cutoff excludes darker skin tones (their Cb/Cr still falls in-range,
      // but their luminance is naturally lower), which would make this
      // check systematically less accurate for users with darker skin.
      // Chroma (Cb/Cr) alone still reliably excludes near-black shadow/background.
      const cb = -0.169 * r - 0.331 * g + 0.5 * b + 128;
      const cr = 0.5 * r - 0.419 * g - 0.081 * b + 128;
      if (cb >= 77 && cb <= 135 && cr >= 133 && cr <= 180) {
        skinPixels++;
      }
    }

    // Variance of Laplacian (blur metric): convolve interior pixels with
    // [[0,1,0],[1,-4,1],[0,1,0]] and take the variance of the responses.
    let lapSum = 0;
    let lapSumSq = 0;
    let lapCount = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const lap = gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w] - 4 * gray[idx];
        lapSum += lap;
        lapSumSq += lap * lap;
        lapCount++;
      }
    }
    const lapMean = lapCount ? lapSum / lapCount : 0;
    const blurVariance = lapCount ? (lapSumSq / lapCount) - (lapMean * lapMean) : 0;

    return {
      meanLuminance: totalPixels ? luminanceSum / totalPixels : 0,
      blurVariance,
      skinPixelRatio: totalPixels ? skinPixels / totalPixels : 0
    };
  }

  function labelIsIrrelevant(label) {
    const lower = String(label || '').toLowerCase();
    return IRRELEVANT_KEYWORDS.some(keyword => lower.includes(keyword));
  }

  /**
   * Validates a File before it is sent to the skin-lesion classifier.
   * Returns { status: 'good'|'poor'|'invalid', reasons: string[], message: string, stats }
   */
  async function validateImageForAnalysis(file) {
    const reasonsInvalid = [];
    const reasonsPoor = [];
    let stats = null;
    let generalTop = null;

    if (!file || !file.type || !file.type.startsWith('image/')) {
      return {
        status: 'invalid',
        reasons: ['File is not a supported image format.'],
        message: 'Unable to analyse this image. Please upload a clear, close-up image of the skin area or lesion.',
        stats: null
      };
    }
    if (file.size > 10 * 1024 * 1024) {
      return {
        status: 'invalid',
        reasons: ['Image is larger than 10 MB.'],
        message: 'Unable to analyse this image. Please upload a clear, close-up image of the skin area or lesion.',
        stats: null
      };
    }

    let img, objectUrl;
    try {
      ({ img, objectUrl } = await loadImageElement(file));
    } catch (error) {
      return {
        status: 'invalid',
        reasons: ['The file could not be read as an image.'],
        message: 'Unable to analyse this image. Please upload a clear, close-up image of the skin area or lesion.',
        stats: null
      };
    }

    try {
      if (img.naturalWidth < MIN_WIDTH || img.naturalHeight < MIN_HEIGHT) {
        reasonsInvalid.push('Image resolution is too low. Please upload a higher-resolution photo.');
      }

      stats = computePixelStats(img);

      // General-classifier relevance gate. Runs even on already-invalid
      // images is skipped to save time/battery — no point classifying an
      // image we're already rejecting for resolution.
      if (reasonsInvalid.length === 0) {
        try {
          const classifier = await getGeneralClassifier();
          const predictions = await classifier(objectUrl, { top_k: 3 });
          generalTop = predictions?.[0] || null;
          if (generalTop && generalTop.score >= IRRELEVANT_CONFIDENCE_MIN && labelIsIrrelevant(generalTop.label)) {
            reasonsInvalid.push('Please upload an image containing the skin area.');
          }
        } catch (error) {
          // If the general classifier fails to load (e.g. offline, first
          // load), don't block the user — fall back to the pixel-level
          // checks only. This is logged, not silently pretended to have run.
          console.warn('General relevance classifier unavailable, continuing with pixel-level checks only:', error);
        }
      }

      if (reasonsInvalid.length === 0) {
        if (stats.blurVariance < BLUR_VARIANCE_MIN) {
          reasonsPoor.push('Image is too blurry.');
        }
        if (stats.meanLuminance < DARK_LUMINANCE_MAX) {
          reasonsPoor.push('Image is too dark.');
        }
        if (stats.meanLuminance > BRIGHT_LUMINANCE_MIN) {
          reasonsPoor.push('Image is too bright / overexposed.');
        }
        if (stats.skinPixelRatio < SKIN_RATIO_SOFT_MIN) {
          reasonsPoor.push('Please move closer to the lesion so more of the skin area is visible.');
        }
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    if (reasonsInvalid.length > 0) {
      return {
        status: 'invalid',
        reasons: reasonsInvalid,
        message: 'Unable to analyse this image. Please upload a clear, close-up image of the skin area or lesion.',
        stats,
        generalTop
      };
    }
    if (reasonsPoor.length > 0) {
      return {
        status: 'poor',
        reasons: reasonsPoor,
        message: reasonsPoor.join(' '),
        stats,
        generalTop
      };
    }
    return {
      status: 'good',
      reasons: [],
      message: 'Image quality looks good.',
      stats,
      generalTop
    };
  }

  return { validateImageForAnalysis };
})();

/* ========================================
   KNOWN LIMITATIONS (read before relying on this in production)
   ========================================
   - The YCbCr skin-tone ratio check uses a single fixed chroma range with
     no luminance floor (testing showed a luminance cutoff biased the check
     against darker skin tones — see the code comment where it's computed).
     It is still a fixed heuristic: it can be thrown off by unusual white
     balance/lighting casts, and it is used ONLY as a soft "poor quality"
     signal (never a hard "invalid" rejection) — never treat it as a
     validated or fairness-audited method.
   - The general-classifier relevance gate uses ImageNet-1k labels, which
     were never designed to include a "skin" or "lesion" class. It can only
     catch images that are confidently something else entirely (a dog, a
     pizza, a car) — it cannot confirm an image IS a lesion, only flag that
     it's probably NOT one. A close-up of a plain non-lesion body part will
     usually still pass.
   - Blur/brightness thresholds are uncalibrated engineering defaults, not
     derived from a labeled dataset of accepted/rejected DERMAMIND photos.
     Tune BLUR_VARIANCE_MIN / DARK_LUMINANCE_MAX / BRIGHT_LUMINANCE_MIN
     against real sample images before relying on this in production.
   ======================================== */
