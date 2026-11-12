# DERMAMIND AI Model

## What changed

The old random/simulation analysis has been replaced with real in-browser image inference using:

- **Model:** `sazio/skin-mole-vit-onnx`
- **Architecture:** Vision Transformer (ViT), ONNX
- **Dataset:** HAM10000 / skin-lesion dataset lineage
- **Classes:** Actinic Keratosis, Basal Cell Carcinoma, Benign Keratosis, Dermatofibroma, Melanoma, Melanocytic Nevus, Vascular Lesion
- **Runtime:** Hugging Face Transformers.js in the browser
- **Quantization:** 8-bit (`q8`) for smaller/faster browser inference

The first scan downloads the model and caches it in the browser. Later scans are faster.

## Important model evidence

The hosted model card identifies this as an ONNX export of a ViT-base model fine-tuned on HAM10000 and explicitly labels it for research/education rather than medical diagnosis. See "Independent model evaluation (Phase 8)" below for real, independently-measured metrics — DERMAMIND does not rely on the model card's own claims for anything shown in the app.

## How the result is calculated

The model returns probabilities for the seven lesion classes. DERMAMIND combines the probabilities of:

- Actinic Keratosis
- Basal Cell Carcinoma
- Melanoma

into a **malignant probability** for screening. The remaining probability is displayed as benign probability.

Risk is shown as:

- **Low:** malignant probability < 15%
- **Medium:** 15%–49%
- **High:** 50% or more

These thresholds are app-level screening thresholds, not clinical diagnostic thresholds.

## Important limitation

This model is trained primarily on dermoscopic skin-lesion images. A normal phone photo, blurry image, distant image, or image with poor lighting may produce unreliable results. DERMAMIND should therefore be presented as an **AI screening/research tool**, not as a cancer diagnosis or medical device.

A dermatologist must make the final assessment, especially for lesions that are new, changing, bleeding, painful, itchy, asymmetric, or otherwise concerning.

## Emergency contact alerts

When the model's **top predicted class** is `akiec`, `bcc`, or `mel`, DERMAMIND treats the result as a concerning screening alert and can notify the registered emergency contact by SMS, email, or both. The patient must provide the mandatory emergency contact and explicitly consent to these alerts.

The notification backend does not receive the uploaded skin image. It receives the screening result and the basic patient details needed for the emergency message.

This workflow is still an alerting mechanism, not a diagnosis. A dermatologist must confirm any concerning result.

## Explainable AI (Phase 7)

DERMAMIND generates a heatmap explaining each prediction using **occlusion sensitivity** (Zeiler & Fergus, 2014), not Grad-CAM. Grad-CAM requires a backward/gradient pass through an intermediate convolutional feature map; this model runs as a forward-inference-only ONNX graph (via ONNX Runtime Web) and is a Vision Transformer rather than a CNN, so it has no such feature map or gradient graph available to it. Occlusion sensitivity only needs repeated forward passes — it works by hiding small regions of the image, re-running the classifier on each variant, and measuring how much the predicted class's probability drops. Regions whose removal drops confidence the most are highlighted.

Trade-off: this needs one forward pass per grid cell (36 passes for the default 6×6 grid, plus 1 baseline), so it is slower and coarser than Grad-CAM would be on a CNN. It runs in the background after the main result is shown, so it doesn't block the user from seeing their screening result.

See `dermamind/xai.js` for the implementation and full rationale.

## Independent model evaluation (Phase 8)

Real, independently-measured metrics — not copied from any model card. Run by loading the actual `model_quantized.onnx` file and running it against 300 real, labeled HAM10000 test images (ground truth from `test_labels.csv`), comparing every prediction to the true label. Full per-image results (predictions, probabilities, confusion matrix) are preserved in `evaluation-results.json`.

**Overall (n=300):**

| Metric | Value |
|---|---|
| Accuracy | 84.67% (254/300 correct) |
| Macro Precision / Recall / F1 | 84.23% / 74.19% / 74.63% |
| Weighted Precision / Recall / F1 | 89.46% / 84.67% / 84.13% |
| Macro ROC-AUC (one-vs-rest) | 0.980 |

**Per-class:**

| Class | Support | Precision | Recall | F1 | Specificity | AUC |
|---|---|---|---|---|---|---|
| Melanocytic nevi | 201 | 94.1% | 96.0% | 95.1% | 87.9% | 0.974 |
| Melanoma | 31 | 50.0% | 90.3% | 64.4% | 89.6% | 0.956 |
| Benign keratosis-like lesions | 38 | 100% | 36.8% | 53.8% | 100% | 0.969 |
| Basal cell carcinoma | 13 | 100% | 46.2% | 63.2% | 100% | 0.986 |
| Actinic keratoses | 8 | 45.5% | 62.5% | 52.6% | 97.9% | 0.976 |
| Vascular lesions | 8 | 100% | 87.5% | 93.3% | 100% | 1.000 |
| Dermatofibroma | 1 | 100% | 100% | 100% | 100% | 1.000 |

**Read this carefully before citing these numbers:**
- The model has high recall but low precision on melanoma (catches 90% of real melanomas, but half of its melanoma calls are false alarms, mostly benign keratosis misclassified as melanoma). For a screening tool that's the safer failure direction, but it means frequent false "possible melanoma" alerts.
- Benign keratosis-like lesions are the weakest class (37% recall) — the model confuses them with melanoma often (16/38 in this test set).
- Dermatofibroma (n=1), actinic keratoses (n=8), and vascular lesions (n=8) have too few samples for a statistically reliable per-class figure — treat those numbers as illustrative, not reliable.
- 300 images is a real but modest sample, not a full held-out validation split. This is a genuine technical test, not a clinical validation study, and should never be presented to users as one.

