# Model Evaluation (Phase 8)

Real evaluation of `sazio/skin-mole-vit-onnx` against 300 real, labeled
HAM10000 test images. See `evaluation-results.json` for full per-image
results and the "Independent model evaluation (Phase 8)" section of
`../AI_MODEL_INFO.md` for the summary and important caveats.

## Reproducing this

You'll need:
- The model's ONNX file + `config.json` + `preprocessor_config.json`
  (from https://huggingface.co/sazio/skin-mole-vit-onnx)
- A labeled test set: a folder of images + a CSV with `image_id,dx`
  columns using HAM10000 short codes (nv, mel, bkl, bcc, akiec, vasc, df)

```bash
npm install onnxruntime-web sharp csv-parse
node evaluate.js
```

Uses `onnxruntime-web` (pure WASM, no native binary/compiler needed) rather
than `onnxruntime-node`, so it runs anywhere Node.js runs without a NuGet/
native-build dependency.

Edit the `MODEL_PATH`, `CSV_PATH`, and `IMAGES_DIR` constants at the top of
`evaluate.js` to point at your files.
