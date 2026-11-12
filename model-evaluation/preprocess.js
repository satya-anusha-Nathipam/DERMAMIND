// Replicates preprocessor_config.json exactly:
//   resize to 224x224 (bilinear), rescale 1/255, normalize with mean=0.5, std=0.5 per channel
// Output layout: NCHW (1,3,224,224), float32 -- the layout ViT/transformers.js expects.
const sharp = require('sharp');

async function preprocessImage(imagePath) {
  const size = 224;
  const { data, info } = await sharp(imagePath)
    .resize(size, size, { fit: 'fill', kernel: 'linear' }) // bilinear, matches resample=2 (BILINEAR)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // data is interleaved HWC (RGBRGBRGB...), need planar CHW, normalized to [-1, 1]
  const chw = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let i = 0; i < plane; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    chw[i] = (r - 0.5) / 0.5;
    chw[plane + i] = (g - 0.5) / 0.5;
    chw[plane * 2 + i] = (b - 0.5) / 0.5;
  }
  return chw;
}

module.exports = { preprocessImage };
