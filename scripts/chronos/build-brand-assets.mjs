import sharp from "sharp";
import { mkdirSync } from "node:fs";

// Derives Chronos's served brand assets from the supplied master art.
// Re-run after a new logo lands:  node scripts/chronos/build-brand-assets.mjs
//
// The master is a 1408x768 / 2.1 MB banner — far too heavy to serve, and the
// wrong shape for the sidebar glyph tile it has to fill. It therefore lives
// OUTSIDE public/ (nothing under assets/ is served) and only the derived
// square mark ships. Tenant.brandLogoUrl points at that mark.

const SRC = "assets/brands/chronos/logo-source.png";
const OUT_DIR = "public/brands/chronos";

// Bounding box of the emblem in master pixels — measured, not guessed: the
// arrow tip pushes the top-right corner well past the disc. The banner's
// "CHRONOS / AGENTIC CRM" wordmark sits below it and is deliberately excluded,
// since BrandMark still renders the splitBrand wordmark as text beside the tile.
// (Padded ~4% past the measured bounds so the art doesn't touch the tile edge.)
const EMBLEM = { left: 362, top: 34, width: 692, height: 524 };

// The box is wider than it is tall, so `contain` letterboxes it. The bars are
// painted the master's own starfield background, which makes them invisible.
const STARFIELD = { r: 28, g: 39, b: 59 };

mkdirSync(OUT_DIR, { recursive: true });

const out = `${OUT_DIR}/mark.png`;
const info = await sharp(SRC)
  .extract(EMBLEM)
  .resize(256, 256, { fit: "contain", background: STARFIELD })
  .png({ compressionLevel: 9, palette: true })
  .toFile(out);

console.log(`wrote ${out} — ${info.width}x${info.height}, ${(info.size / 1024).toFixed(1)} KB`);
