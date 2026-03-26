/* eslint-disable @typescript-eslint/no-require-imports */
const sharp = require('sharp');
const path = require('path');

const svgPath = path.join(__dirname, '..', 'public', 'icons', 'icon.svg');
const outDir = path.join(__dirname, '..', 'public', 'icons');

async function generate() {
  const sizes = [192, 512];
  for (const size of sizes) {
    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, `icon-${size}.png`));

    // Maskable version (with padding — 80% safe zone)
    const padding = Math.floor(size * 0.1);
    await sharp(svgPath)
      .resize(size - padding * 2, size - padding * 2)
      .extend({
        top: padding, bottom: padding, left: padding, right: padding,
        background: { r: 10, g: 10, b: 15, alpha: 1 }
      })
      .png()
      .toFile(path.join(outDir, `icon-maskable-${size}.png`));
  }

  // Apple touch icon
  await sharp(svgPath)
    .resize(180, 180)
    .png()
    .toFile(path.join(outDir, 'apple-touch-icon.png'));

  console.log('Icons generated!');
}

generate();
