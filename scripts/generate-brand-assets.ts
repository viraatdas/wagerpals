/**
 * generate-brand-assets.ts
 *
 * Reproducible converter: turns the three hand-authored source marks in
 * `scripts/brand/` into the full WagerPals icon/asset set for web, PWA and
 * iOS/Android (mobile).
 *
 * Run with: `npm run brand:assets` (invokes `tsx scripts/generate-brand-assets.ts`).
 *
 * IMPORTANT: this script never hardcodes anything about the *artwork's
 * geometry* (paths, circles, etc). It only relies on the documented contract
 * of the source files in `scripts/brand/` — a square `viewBox`, transparent
 * background, mark optically centred — and extracts everything else (the
 * inner markup, the viewBox size) at runtime via regex. Swap the artwork in
 * `scripts/brand/*.svg` for real logo art later and this script keeps working
 * unchanged.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const BRAND_DIR = join(ROOT, 'scripts/brand');

// Brand diagonal gradient used for every "gradient" background tile.
// Phosphor green — the app's single accent (app/globals.css --brand-2/--brand-3).
// White coins on saturated green is what makes the installed icon legible at
// 40px on a crowded home screen; the dark UI palette does not tile well there.
const BRAND_GRADIENT_FROM = '#24E17A';
const BRAND_GRADIENT_TO = '#0F9E56';

// Density used when rasterizing the composed SVG string with sharp/librsvg.
// A high density keeps edges crisp before the explicit resize() to the exact
// target pixel size below — we never upscale an already-small PNG.
//
// A single fixed density (e.g. 2400) is NOT safe across this script's whole
// size range: sharp scales a vector image's raw pixel dimensions by
// density/72 before the resize() call, and it refuses to decode an input
// above 268,402,689px (16383px per side — see node_modules/sharp/lib/input.js,
// `limitInputPixels`). At density 2400 that ceiling is hit for any canvas
// above ~245px, which includes several targets below (512px, 1024px). Instead
// we derive a density that supersamples every target by a constant factor
// (crisp anti-aliasing even at 16px) capped so the intermediate raster never
// exceeds MAX_RASTER_DIM px per side — safely under sharp's limit for every
// size this script produces (max 1024px).
const SUPERSAMPLE = 8;
const MAX_RASTER_DIM = 8192;

function densityForSize(size: number): number {
  const rawDim = Math.min(size * SUPERSAMPLE, MAX_RASTER_DIM);
  return Math.round(72 * (rawDim / size));
}

type SourceMark = 'mark' | 'mark-white' | 'mark-silhouette';

const MARK_FILES: Record<SourceMark, string> = {
  mark: join(BRAND_DIR, 'mark.svg'),
  'mark-white': join(BRAND_DIR, 'mark-white.svg'),
  'mark-silhouette': join(BRAND_DIR, 'mark-silhouette.svg'),
};

interface LoadedMark {
  /** Inner markup between the outer <svg ...> and </svg> tags. */
  inner: string;
  /** Square viewBox size (width === height), read from the file, not assumed. */
  viewBoxSize: number;
  /** viewBox min-x / min-y, in case a future source mark doesn't start at 0,0. */
  minX: number;
  minY: number;
}

const markCache = new Map<SourceMark, LoadedMark>();

/**
 * Load a source mark SVG, extract its inner markup and its viewBox geometry.
 * Cached per source since multiple outputs reuse the same mark.
 */
async function loadMark(source: SourceMark): Promise<LoadedMark> {
  const cached = markCache.get(source);
  if (cached) return cached;

  const path = MARK_FILES[source];
  const text = await readFile(path, 'utf8');

  const viewBoxMatch = text.match(/viewBox="([^"]+)"/);
  if (!viewBoxMatch) {
    throw new Error(`${path}: missing viewBox attribute on the outer <svg> element`);
  }
  const parts = viewBoxMatch[1].trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`${path}: could not parse viewBox="${viewBoxMatch[1]}"`);
  }
  const [minX, minY, width, height] = parts;
  if (width !== height) {
    throw new Error(`${path}: viewBox must be square, got ${width}x${height}`);
  }

  const innerMatch = text.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!innerMatch) {
    throw new Error(`${path}: could not find inner markup between <svg> and </svg>`);
  }

  const loaded: LoadedMark = { inner: innerMatch[1].trim(), viewBoxSize: width, minX, minY };
  markCache.set(source, loaded);
  return loaded;
}

/** Background for a composed tile. */
type Background = 'none' | 'gradient' | { solid: string };

interface TileOptions {
  /** Output canvas size in px (square). */
  size: number;
  background: Background;
  /** Corner radius as a fraction of `size` (0 = square corners). */
  cornerRadiusFraction: number;
  markSource: SourceMark;
  /**
   * Width of the mark's *viewBox* as a fraction of the canvas width. The
   * artwork does not fill its 64-unit viewBox edge to edge (the current mark
   * spans about 94% of it), so the visible ink lands a few percent below this
   * number — the values below are tuned against the real art, not derived.
   */
  markScale: number;
  /** Override the generated gradient element id (needed when embedding a tile inside another SVG). */
  gradientId?: string;
}

/** Trim a number to 6 decimal places without trailing zeros, for compact SVG attributes. */
function fmt(n: number): string {
  return Number(n.toFixed(6)).toString();
}

/**
 * Build the inner content of a tile (defs + background rect + transformed mark
 * group) WITHOUT the outer <svg> wrapper, so it can be embedded standalone or
 * nested inside a larger composition (e.g. the OG card).
 */
async function buildTileFragment(opts: TileOptions): Promise<string> {
  const { size, background, cornerRadiusFraction, markSource, markScale } = opts;
  const gradientId = opts.gradientId ?? 'brandGrad';
  const mark = await loadMark(markSource);

  const renderedMarkWidth = size * markScale;
  const scale = renderedMarkWidth / mark.viewBoxSize;
  const tx = (size - mark.viewBoxSize * scale) / 2 - mark.minX * scale;
  const ty = (size - mark.viewBoxSize * scale) / 2 - mark.minY * scale;
  const radius = size * cornerRadiusFraction;

  let defs = '';
  let backgroundRect = '';
  if (background === 'gradient') {
    defs = `<linearGradient id="${gradientId}" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${BRAND_GRADIENT_FROM}"/><stop offset="100%" stop-color="${BRAND_GRADIENT_TO}"/></linearGradient>`;
    backgroundRect = `<rect x="0" y="0" width="${size}" height="${size}" rx="${fmt(radius)}" ry="${fmt(radius)}" fill="url(#${gradientId})"/>`;
  } else if (background !== 'none') {
    backgroundRect = `<rect x="0" y="0" width="${size}" height="${size}" rx="${fmt(radius)}" ry="${fmt(radius)}" fill="${background.solid}"/>`;
  }

  const defsBlock = defs ? `<defs>${defs}</defs>` : '';

  return `${defsBlock}${backgroundRect}<g transform="translate(${fmt(tx)},${fmt(ty)}) scale(${fmt(scale)})">${mark.inner}</g>`;
}

/** Build a complete, standalone SVG document for a tile. */
async function composeSvg(opts: TileOptions): Promise<string> {
  const fragment = await buildTileFragment(opts);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.size}" height="${opts.size}" viewBox="0 0 ${opts.size} ${opts.size}">${fragment}</svg>`;
}

/** Rasterize a composed SVG string to a PNG buffer at an exact pixel size. */
async function renderPng(svg: string, width: number, height: number = width): Promise<Buffer> {
  const density = densityForSize(Math.max(width, height));
  return sharp(Buffer.from(svg), { density }).resize(width, height).png().toBuffer();
}

const writtenFiles: string[] = [];

async function writeArtifact(path: string, data: Buffer | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  const bytes = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data, 'utf8');
  writtenFiles.push(path);
  console.log(`wrote ${relative(ROOT, path)} (${bytes} bytes)`);
}

// ---------------------------------------------------------------------------
// favicon.ico packer (no new dependency — PNG payloads embedded directly,
// which is valid ICO and universally supported at these sizes).
// ---------------------------------------------------------------------------

interface IcoImage {
  size: number;
  png: Buffer;
}

function packIco(images: IcoImage[]): Buffer {
  const HEADER_SIZE = 6;
  const ENTRY_SIZE = 16;
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(0, 0); // reserved, must be 0
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(images.length, 4); // image count

  const entries: Buffer[] = [];
  const payloads: Buffer[] = [];
  let offset = HEADER_SIZE + ENTRY_SIZE * images.length;

  for (const { size, png } of images) {
    const entry = Buffer.alloc(ENTRY_SIZE);
    const dim = size >= 256 ? 0 : size; // 0 means 256px per the ICO spec
    entry.writeUInt8(dim, 0); // width
    entry.writeUInt8(dim, 1); // height
    entry.writeUInt8(0, 2); // colour count (0 = no palette)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8); // payload byte size
    entry.writeUInt32LE(offset, 12); // payload byte offset
    offset += png.length;
    entries.push(entry);
    payloads.push(png);
  }

  return Buffer.concat([header, ...entries, ...payloads]);
}

// ---------------------------------------------------------------------------
// Raster PNG asset table
// ---------------------------------------------------------------------------

interface PngAssetSpec extends TileOptions {
  key: string;
  outPath: string;
  /**
   * Force the output to have no alpha channel at all (as opposed to merely
   * being visually opaque). Required for the iOS App Store icon.
   */
  forceOpaque?: boolean;
}

const PNG_ASSETS: PngAssetSpec[] = [
  {
    key: 'icon16',
    outPath: join(ROOT, 'public/icons/icon-16x16.png'),
    size: 16,
    background: 'gradient',
    cornerRadiusFraction: 0.2,
    markSource: 'mark-white',
    markScale: 0.78,
  },
  {
    key: 'icon32',
    outPath: join(ROOT, 'public/icons/icon-32x32.png'),
    size: 32,
    background: 'gradient',
    cornerRadiusFraction: 0.2,
    markSource: 'mark-white',
    markScale: 0.78,
  },
  {
    key: 'icon48',
    outPath: join(ROOT, 'public/icons/icon-48x48.png'),
    size: 48,
    background: 'gradient',
    cornerRadiusFraction: 0.2,
    markSource: 'mark-white',
    markScale: 0.78,
  },
  {
    key: 'appleTouch',
    outPath: join(ROOT, 'public/icons/apple-touch-icon.png'),
    size: 180,
    background: 'gradient',
    cornerRadiusFraction: 0, // full-bleed square — iOS applies its own rounded-square mask
    markSource: 'mark-white',
    markScale: 0.66,
  },
  {
    key: 'icon192',
    outPath: join(ROOT, 'public/icons/icon-192x192.png'),
    size: 192,
    background: 'gradient',
    cornerRadiusFraction: 0.22,
    markSource: 'mark-white',
    markScale: 0.70,
  },
  {
    key: 'icon512',
    outPath: join(ROOT, 'public/icons/icon-512x512.png'),
    size: 512,
    background: 'gradient',
    cornerRadiusFraction: 0.22,
    markSource: 'mark-white',
    markScale: 0.70,
  },
  // PWA maskable icons are cropped by installers to a centred circle of 80%
  // diameter — keep the mark well inside that safe zone, hence the small
  // 0.50 scale and full-bleed (0 corner radius) background.
  {
    key: 'iconMaskable192',
    outPath: join(ROOT, 'public/icons/icon-maskable-192x192.png'),
    size: 192,
    background: 'gradient',
    cornerRadiusFraction: 0,
    markSource: 'mark-white',
    markScale: 0.55,
  },
  {
    key: 'iconMaskable512',
    outPath: join(ROOT, 'public/icons/icon-maskable-512x512.png'),
    size: 512,
    background: 'gradient',
    cornerRadiusFraction: 0,
    markSource: 'mark-white',
    markScale: 0.55,
  },
  {
    key: 'mobileIcon',
    outPath: join(ROOT, 'mobile/assets/icon.png'),
    size: 1024,
    background: 'gradient',
    cornerRadiusFraction: 0, // full-bleed square, fully opaque — App Store rejects transparency
    markSource: 'mark-white',
    markScale: 0.66,
    forceOpaque: true,
  },
  // Android adaptive icon foregrounds are cropped by the OS to the centred
  // 66% of the canvas — keep the mark inside that safe zone, hence the small
  // 0.46 scale. Background stays transparent; Android renders its own
  // background layer behind the foreground.
  {
    key: 'mobileAdaptive',
    outPath: join(ROOT, 'mobile/assets/adaptive-icon.png'),
    size: 1024,
    background: 'none',
    cornerRadiusFraction: 0,
    markSource: 'mark-white',
    markScale: 0.52,
  },
  {
    key: 'mobileSplash',
    outPath: join(ROOT, 'mobile/assets/splash-icon.png'),
    size: 1024,
    background: 'none',
    cornerRadiusFraction: 0,
    markSource: 'mark',
    markScale: 0.42,
  },
  {
    key: 'mobileFavicon',
    outPath: join(ROOT, 'mobile/assets/favicon.png'),
    size: 48,
    background: 'gradient',
    cornerRadiusFraction: 0.2,
    markSource: 'mark-white',
    markScale: 0.78,
  },
  // Android notification icons are rendered from the alpha channel only, so
  // the source mark must be an all-white flat silhouette.
  {
    key: 'mobileNotification',
    outPath: join(ROOT, 'mobile/assets/notification-icon.png'),
    size: 96,
    background: 'none',
    cornerRadiusFraction: 0,
    markSource: 'mark-silhouette',
    markScale: 0.7,
  },
];

// ---------------------------------------------------------------------------
// OpenGraph card
// ---------------------------------------------------------------------------

async function buildOgSvg(): Promise<string> {
  const width = 1200;
  const height = 630;
  const marginX = 96;
  const tileSize = 160;
  const tileY = 127;
  const headlineBaseline = 403;
  const taglineBaseline = 459;
  const ruleY = 497;
  const ruleWidth = 220;
  const ruleHeight = 6;

  const tileFragment = await buildTileFragment({
    size: tileSize,
    background: 'gradient',
    cornerRadiusFraction: 0.22,
    markSource: 'mark-white',
    markScale: 0.70,
    gradientId: 'ogTileGrad',
  });

  // Oversized watermark of the mark, bleeding off the right edge. The text
  // block sits on the left third, so without this the right two-thirds of the
  // card read as dead space. Kept at a very low opacity so it never competes
  // with the headline.
  const watermark = await loadMark('mark');
  const watermarkSize = 620;
  const watermarkScale = watermarkSize / watermark.viewBoxSize;
  const watermarkX = width - watermarkSize * 0.62;
  const watermarkY = (height - watermarkSize) / 2;

  // NOTE: "Space Grotesk" is listed first in the font-family stack below. If
  // this script is ever re-run on a machine that doesn't have that font
  // installed, sharp/librsvg silently falls back to Helvetica/Arial when
  // rasterizing — so the *committed* public/og.png is the canonical artifact,
  // not something to regenerate casually on an arbitrary machine.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="ogPanelGrad" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#121417"/>
      <stop offset="100%" stop-color="#0A0B0D"/>
    </linearGradient>
    <linearGradient id="ogRuleGrad" x1="0" y1="0" x2="${ruleWidth}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${BRAND_GRADIENT_FROM}"/>
      <stop offset="100%" stop-color="${BRAND_GRADIENT_TO}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#ogPanelGrad)"/>
  <g opacity="0.08" transform="translate(${fmt(watermarkX)},${fmt(watermarkY)}) scale(${fmt(watermarkScale)})">${watermark.inner}</g>
  <g transform="translate(${marginX},${tileY})">${tileFragment}</g>
  <text x="${marginX}" y="${headlineBaseline}" font-family="Space Grotesk, Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="84" fill="#E9ECEF">WagerPals</text>
  <text x="${marginX}" y="${taglineBaseline}" font-family="Space Grotesk, Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="400" font-size="34" fill="#A2A9B2">Bet with your friends. Settle the ledger.</text>
  <rect x="${marginX}" y="${ruleY}" width="${ruleWidth}" height="${ruleHeight}" rx="${ruleHeight / 2}" fill="url(#ogRuleGrad)"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// Self-check
// ---------------------------------------------------------------------------

async function selfCheck(expectedFiles: string[]): Promise<void> {
  const problems: string[] = [];

  for (const file of expectedFiles) {
    try {
      const stats = await stat(file);
      if (stats.size === 0) {
        problems.push(`${relative(ROOT, file)} is zero bytes`);
      }
    } catch {
      problems.push(`${relative(ROOT, file)} is missing`);
    }
  }

  const mobileIconPath = join(ROOT, 'mobile/assets/icon.png');
  try {
    const metadata = await sharp(mobileIconPath).metadata();
    if (metadata.hasAlpha) {
      problems.push('mobile/assets/icon.png must not have an alpha channel (App Store requirement)');
    }
  } catch (error) {
    problems.push(`could not read metadata for mobile/assets/icon.png: ${String(error)}`);
  }

  if (problems.length > 0) {
    console.error('\nSelf-check FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nSelf-check passed: ${expectedFiles.length} artifacts verified.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Raster PNG assets (favicon, web icons, PWA icons, mobile assets).
  const renderedPngs = new Map<string, Buffer>();
  for (const asset of PNG_ASSETS) {
    const svg = await composeSvg(asset);
    let buffer: Buffer;
    if (asset.forceOpaque) {
      buffer = await sharp(Buffer.from(svg), { density: densityForSize(asset.size) })
        .resize(asset.size, asset.size)
        .flatten({ background: BRAND_GRADIENT_TO })
        .removeAlpha()
        .png()
        .toBuffer();
    } else {
      buffer = await renderPng(svg, asset.size);
    }
    renderedPngs.set(asset.key, buffer);
    await writeArtifact(asset.outPath, buffer);
  }

  // 2. favicon.ico — pack the 16/32/48 PNGs already rendered above.
  const icoBuffer = packIco([
    { size: 16, png: renderedPngs.get('icon16')! },
    { size: 32, png: renderedPngs.get('icon32')! },
    { size: 48, png: renderedPngs.get('icon48')! },
  ]);
  await writeArtifact(join(ROOT, 'public/favicon.ico'), icoBuffer);

  // 3. Text SVG tiles — icon-192x192.svg / icon-512x512.svg already exist and
  // are referenced by app/page.tsx and public/service-worker.js, so they must
  // keep existing at these paths; only their artwork changes here.
  const tileSvg192 = await composeSvg({
    size: 192,
    background: 'gradient',
    cornerRadiusFraction: 0.22,
    markSource: 'mark-white',
    markScale: 0.70,
  });
  await writeArtifact(join(ROOT, 'public/icons/icon-192x192.svg'), tileSvg192);

  const tileSvg512 = await composeSvg({
    size: 512,
    background: 'gradient',
    cornerRadiusFraction: 0.22,
    markSource: 'mark-white',
    markScale: 0.70,
  });
  await writeArtifact(join(ROOT, 'public/icons/icon-512x512.svg'), tileSvg512);
  await writeArtifact(join(ROOT, 'public/icons/wagerpals-tile.svg'), tileSvg512);

  // 4. wagerpals-mark.svg — a plain copy of the full-colour source mark.
  const markSourceText = await readFile(join(BRAND_DIR, 'mark.svg'), 'utf8');
  await writeArtifact(join(ROOT, 'public/icons/wagerpals-mark.svg'), markSourceText);

  // 5. OpenGraph card.
  const ogSvg = await buildOgSvg();
  const ogBuffer = await renderPng(ogSvg, 1200, 630);
  await writeArtifact(join(ROOT, 'public/og.png'), ogBuffer);

  // 6. Self-check.
  await selfCheck(writtenFiles);
}

main().catch((error) => {
  console.error('\nUnexpected error while generating brand assets:');
  console.error(error);
  process.exitCode = 1;
});
