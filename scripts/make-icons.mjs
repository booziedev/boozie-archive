#!/usr/bin/env node
/**
 * Regenerates the favicon and PWA icon set from one source image.
 *
 *   npm run icons                          # uses frontend/public/icons/logo.png
 *   npm run icons -- path/to/artwork.png   # or any square-ish image
 *
 * Drop your logo in as `frontend/public/icons/logo.png`, run this, rebuild the
 * frontend, and the mark, the browser tab icon and the iOS home-screen icon all
 * follow. Transparency is preserved for the regular sizes; the maskable icon is
 * flattened onto the app background because launchers crop and tint it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(repoRoot, 'frontend', 'public', 'icons');
const defaultSource = path.join(iconsDir, 'logo.png');

const source = process.argv[2] ? path.resolve(process.argv[2]) : defaultSource;

/** The app's background, so a flattened icon matches the UI. */
const BACKGROUND = { r: 6, g: 6, b: 10, alpha: 1 };

const TARGETS = [
  { file: 'favicon-16.png', size: 16 },
  { file: 'favicon-32.png', size: 32 },
  { file: 'favicon-48.png', size: 48 },
  { file: 'apple-touch-icon.png', size: 180, flatten: true, padding: 0.08 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  // Launchers crop maskable icons to a circle/squircle, so keep the art well
  // inside the safe zone and give it an opaque ground.
  { file: 'icon-maskable-512.png', size: 512, flatten: true, padding: 0.2 },
];

if (!fs.existsSync(source)) {
  console.error(
    `\nNo source image at ${source}\n\n` +
      `  Save your logo as frontend/public/icons/logo.png (square PNG, 512px or larger,\n` +
      `  transparent background if you have one), then run this again.\n`,
  );
  process.exit(1);
}

let sharp;
try {
  sharp = (await import(path.join(repoRoot, 'backend', 'node_modules', 'sharp', 'lib', 'index.js')))
    .default;
} catch {
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error(
      '\nsharp is not installed, so the icons cannot be resized.\n' +
        '  npm --prefix backend install sharp\n',
    );
    process.exit(1);
  }
}

const meta = await sharp(source).metadata();
console.log(`Source: ${path.relative(repoRoot, source)} (${meta.width}x${meta.height} ${meta.format})`);
if ((meta.width ?? 0) < 256 || (meta.height ?? 0) < 256) {
  console.warn('  Warning: smaller than 256px — the large icons will look soft.');
}

for (const target of TARGETS) {
  const inner = Math.round(target.size * (1 - (target.padding ?? 0) * 2));
  let image = sharp(source)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: Math.round((target.size - inner) / 2),
      bottom: target.size - inner - Math.round((target.size - inner) / 2),
      left: Math.round((target.size - inner) / 2),
      right: target.size - inner - Math.round((target.size - inner) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });

  if (target.flatten) image = image.flatten({ background: BACKGROUND });

  await image.png({ compressionLevel: 9 }).toFile(path.join(iconsDir, target.file));
  console.log(`  wrote icons/${target.file} (${target.size}px)`);
}

console.log('\nDone. Rebuild the frontend to publish them:\n  npm --prefix frontend run build\n');
