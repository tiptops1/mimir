import sharp from "sharp";
import { mkdirSync } from "node:fs";

// Renders the PWA icons from the BrandMark SVG (src/components/brand.tsx):
// four rising bars on the indigo brand square. Re-run after a brand change:
//   node scripts/generate-icons.mjs

const BRAND = "#4f46e5";

// s = content scale (1 = full frame). Maskable icons keep the art inside the
// 80% safe zone so launchers can crop to any shape without clipping the bars.
function iconSvg({ size, radius, scale }) {
  const g = (n) => (size / 2 + (n - 256) * scale).toFixed(1);
  // Bar geometry mapped from the 24-viewBox mark (x 4/9/14/19, baseline y 19).
  const bars = [
    { x: 85, top: 235 },
    { x: 192, top: 128 },
    { x: 299, top: 213 },
    { x: 405, top: 171 },
  ]
    .map(
      ({ x, top }) =>
        `M ${g(x)} ${g(405)} L ${g(x)} ${g(top)}`,
    )
    .join(" ");
  return Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND}"/>
  <path d="${bars}" stroke="#ffffff" stroke-width="${51 * scale}" stroke-linecap="round" fill="none"/>
</svg>`);
}

mkdirSync("public/icons", { recursive: true });

const jobs = [
  { file: "public/icons/icon-192.png", size: 192, radius: 42, scale: 192 / 512 },
  { file: "public/icons/icon-512.png", size: 512, radius: 112, scale: 1 },
  // Full-bleed square + smaller art = safe under any launcher mask.
  { file: "public/icons/icon-maskable-512.png", size: 512, radius: 0, scale: 0.72 },
  { file: "src/app/apple-icon.png", size: 180, radius: 0, scale: 180 / 512 },
];

for (const { file, size, radius, scale } of jobs) {
  await sharp(iconSvg({ size, radius, scale })).png().toFile(file);
  console.log("wrote", file);
}
