// DERMAMIND - Phase 8: Real Model Evaluation
// Runs the actual sazio/skin-mole-vit-onnx model (quantized ONNX) against
// 300 real, labeled HAM10000 test images and computes genuine metrics.
// No numbers here are invented -- every figure comes from this run.

const ort = require('onnxruntime-web/wasm');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { preprocessImage } = require('./preprocess');

const MODEL_PATH = './model/model/model_quantized.onnx';
const CSV_PATH = './test-data/test-data/test_labels.csv';
const IMAGES_DIR = './test-data/test-data/images';

const ID2LABEL = {
  0: 'benign_keratosis-like_lesions',
  1: 'basal_cell_carcinoma',
  2: 'actinic_keratoses',
  3: 'vascular_lesions',
  4: 'melanocytic_Nevi',
  5: 'melanoma',
  6: 'dermatofibroma'
};

// HAM10000 short codes (as used in test_labels.csv) -> model label names
const DX_TO_LABEL = {
  bkl: 'benign_keratosis-like_lesions',
  bcc: 'basal_cell_carcinoma',
  akiec: 'actinic_keratoses',
  vasc: 'vascular_lesions',
  nv: 'melanocytic_Nevi',
  mel: 'melanoma',
  df: 'dermatofibroma'
};

const CLASSES = Object.values(ID2LABEL); // fixed order used throughout

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map(x => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(x => x / sum);
}

// One-vs-rest ROC-AUC via the Mann-Whitney U / rank-sum method (no threshold
// sweep needed, exact for finite samples).
function rocAucOneVsRest(scores, trueLabels, positiveClass) {
  const paired = scores.map((s, i) => ({ score: s, isPositive: trueLabels[i] === positiveClass }));
  const nPos = paired.filter(p => p.isPositive).length;
  const nNeg = paired.length - nPos;
  if (nPos === 0 || nNeg === 0) return null; // undefined AUC when a class is absent/all-present

  paired.sort((a, b) => a.score - b.score);
  // Assign ranks, averaging ties
  let rank = 1;
  const ranks = new Array(paired.length);
  let i = 0;
  while (i < paired.length) {
    let j = i;
    while (j + 1 < paired.length && paired[j + 1].score === paired[i].score) j++;
    const avgRank = (rank + (rank + (j - i))) / 2;
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    rank += (j - i + 1);
    i = j + 1;
  }
  let sumRanksPos = 0;
  for (let k = 0; k < paired.length; k++) if (paired[k].isPositive) sumRanksPos += ranks[k];
  const auc = (sumRanksPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
  return auc;
}

async function main() {
  console.log('=== DERMAMIND Phase 8: Real Model Evaluation ===');
  console.log('Model:', MODEL_PATH);
  console.log('Test set:', CSV_PATH, '+', IMAGES_DIR);

  const csvRaw = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parse(csvRaw, { columns: true, skip_empty_lines: true });
  console.log(`Loaded ${rows.length} labeled test images.\n`);

  console.log('Loading ONNX model...');
  const modelBuffer = fs.readFileSync(MODEL_PATH);
  const session = await ort.InferenceSession.create(new Uint8Array(modelBuffer));
  console.log('Model loaded.\n');

  const trueLabels = [];
  const predLabels = [];
  const allProbs = []; // array of {label: prob} per image, for AUC

  const startTime = Date.now();
  for (let i = 0; i < rows.length; i++) {
    const { image_id, dx } = rows[i];
    const trueLabel = DX_TO_LABEL[dx];
    if (!trueLabel) {
      console.warn(`Unknown dx code "${dx}" for ${image_id}, skipping.`);
      continue;
    }

    const imagePath = path.join(IMAGES_DIR, `${image_id}.jpg`);
    const chw = await preprocessImage(imagePath);
    const tensor = new ort.Tensor('float32', chw, [1, 3, 224, 224]);
    const results = await session.run({ pixel_values: tensor });
    const logits = Array.from(results.logits.data);
    const probs = softmax(logits);

    const topIdx = probs.indexOf(Math.max(...probs));
    const predLabel = ID2LABEL[topIdx];

    trueLabels.push(trueLabel);
    predLabels.push(predLabel);
    const probMap = {};
    CLASSES.forEach((c, idx) => { probMap[c] = probs[idx]; });
    allProbs.push(probMap);

    if ((i + 1) % 25 === 0 || i === rows.length - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  processed ${i + 1}/${rows.length} images (${elapsed}s elapsed)`);
    }
  }

  const n = trueLabels.length;
  console.log(`\nInference complete on ${n} images in ${((Date.now() - startTime) / 1000).toFixed(1)}s.\n`);

  // --- Confusion matrix ---
  const matrix = {}; // matrix[true][pred] = count
  CLASSES.forEach(c => { matrix[c] = {}; CLASSES.forEach(c2 => { matrix[c][c2] = 0; }); });
  for (let i = 0; i < n; i++) matrix[trueLabels[i]][predLabels[i]]++;

  // --- Per-class TP/FP/FN/TN, precision/recall/F1/specificity/support ---
  const perClass = {};
  for (const c of CLASSES) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const t of CLASSES) {
      for (const p of CLASSES) {
        const count = matrix[t][p];
        if (t === c && p === c) tp += count;
        else if (t !== c && p === c) fp += count;
        else if (t === c && p !== c) fn += count;
        else tn += count;
      }
    }
    const support = tp + fn;
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const specificity = (tn + fp) > 0 ? tn / (tn + fp) : 0;
    const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
    const scores = allProbs.map(p => p[c]);
    const auc = rocAucOneVsRest(scores, trueLabels, c);
    perClass[c] = { tp, fp, fn, tn, support, precision, recall, specificity, f1, auc };
  }

  const overallAccuracy = trueLabels.filter((t, i) => t === predLabels[i]).length / n;

  const macroPrecision = CLASSES.reduce((s, c) => s + perClass[c].precision, 0) / CLASSES.length;
  const macroRecall = CLASSES.reduce((s, c) => s + perClass[c].recall, 0) / CLASSES.length;
  const macroF1 = CLASSES.reduce((s, c) => s + perClass[c].f1, 0) / CLASSES.length;

  const weightedPrecision = CLASSES.reduce((s, c) => s + perClass[c].precision * perClass[c].support, 0) / n;
  const weightedRecall = CLASSES.reduce((s, c) => s + perClass[c].recall * perClass[c].support, 0) / n;
  const weightedF1 = CLASSES.reduce((s, c) => s + perClass[c].f1 * perClass[c].support, 0) / n;

  const validAucs = CLASSES.map(c => perClass[c].auc).filter(a => a !== null);
  const macroAuc = validAucs.length ? validAucs.reduce((a, b) => a + b, 0) / validAucs.length : null;

  const report = {
    generatedAt: new Date().toISOString(),
    model: 'sazio/skin-mole-vit-onnx (model_quantized.onnx)',
    testSet: { source: 'user-provided HAM10000 subset', totalImages: n, csvPath: CSV_PATH },
    overallAccuracy,
    macro: { precision: macroPrecision, recall: macroRecall, f1: macroF1, aucOneVsRest: macroAuc },
    weighted: { precision: weightedPrecision, recall: weightedRecall, f1: weightedF1 },
    perClass,
    confusionMatrix: { classes: CLASSES, matrix }
  };

  fs.writeFileSync('./evaluation-results.json', JSON.stringify(report, null, 2));
  console.log('Full results written to evaluation-results.json\n');

  // --- Console summary ---
  console.log('=== OVERALL ===');
  console.log('Accuracy:', (overallAccuracy * 100).toFixed(2) + '%', `(${trueLabels.filter((t,i)=>t===predLabels[i]).length}/${n} correct)`);
  console.log('Macro Precision:', (macroPrecision * 100).toFixed(2) + '%');
  console.log('Macro Recall:', (macroRecall * 100).toFixed(2) + '%');
  console.log('Macro F1:', (macroF1 * 100).toFixed(2) + '%');
  console.log('Weighted Precision:', (weightedPrecision * 100).toFixed(2) + '%');
  console.log('Weighted Recall:', (weightedRecall * 100).toFixed(2) + '%');
  console.log('Weighted F1:', (weightedF1 * 100).toFixed(2) + '%');
  console.log('Macro ROC-AUC (one-vs-rest):', macroAuc !== null ? macroAuc.toFixed(4) : 'N/A');

  console.log('\n=== PER-CLASS ===');
  console.log('class'.padEnd(32), 'support'.padEnd(8), 'precision'.padEnd(10), 'recall'.padEnd(8), 'f1'.padEnd(8), 'specificity'.padEnd(12), 'auc');
  for (const c of CLASSES) {
    const m = perClass[c];
    console.log(
      c.padEnd(32),
      String(m.support).padEnd(8),
      (m.precision * 100).toFixed(1).padEnd(10),
      (m.recall * 100).toFixed(1).padEnd(8),
      (m.f1 * 100).toFixed(1).padEnd(8),
      (m.specificity * 100).toFixed(1).padEnd(12),
      m.auc !== null ? m.auc.toFixed(3) : 'N/A'
    );
  }

  console.log('\n=== CONFUSION MATRIX (rows=true, cols=predicted) ===');
  const header = ['true\\pred', ...CLASSES.map(c => c.slice(0, 8))].join(' | ');
  console.log(header);
  for (const t of CLASSES) {
    const row = [t.slice(0, 20).padEnd(20), ...CLASSES.map(p => String(matrix[t][p]).padStart(8))];
    console.log(row.join(' | '));
  }
}

main().catch(e => { console.error('EVALUATION FAILED:', e); process.exit(1); });
