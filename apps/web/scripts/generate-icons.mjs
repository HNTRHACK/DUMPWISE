// Regenerates the raster icons from src/app/icon.svg (the single source of truth).
//   node scripts/generate-icons.mjs
// Outputs (Next.js App Router metadata file conventions):
//   src/app/favicon.ico      16/32/48 px PNG frames, transparent rounded corners
//   src/app/apple-icon.png   180 px, opaque full-bleed (iOS applies its own mask)
// Rendering uses the Playwright Chromium already installed for tests; the ICO container is
// written by hand (ICO may embed PNG frames), so no extra dependency is needed.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = readFileSync(new URL("../src/app/icon.svg", import.meta.url), "utf8");
// iOS masks icons itself: drop the rounded corners for an opaque square.
const squareSvg = svg.replace('rx="7" fill="#110B08"', 'fill="#110B08"');

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(source, size) {
  await page.setViewportSize({ width: size, height: size });
  const src = `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`);
  await page.locator("img").evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const frames = [];
for (const size of [16, 32, 48]) frames.push({ size, png: await render(svg, size) });
const apple = await render(squareSvg, 180);
await browser.close();

// ICO: 6-byte header, 16-byte directory entry per image, then the PNG payloads.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type 1 = icon
header.writeUInt16LE(frames.length, 4);
let offset = 6 + 16 * frames.length;
const entries = frames.map(({ size, png }) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size, 0); // width
  e.writeUInt8(size, 1); // height
  e.writeUInt8(0, 2); // palette colours
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});
writeFileSync(new URL("../src/app/favicon.ico", import.meta.url), Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]));
writeFileSync(new URL("../src/app/apple-icon.png", import.meta.url), apple);
console.log(`favicon.ico: ${frames.map((f) => `${f.size}px`).join(", ")}; apple-icon.png: 180px`);
