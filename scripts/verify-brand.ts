/**
 * verify-brand.ts
 *
 * Deploy gate for the WagerPals brand identity. It never writes anything — it
 * only reads the repo and fails loudly. Run with `npm run brand:verify`.
 *
 * It checks the three ways this identity has previously shipped broken:
 *
 *   1. GLYPH DRIFT — components/Logo.tsx (what the header renders) and
 *      scripts/brand/*.svg (what every icon is rasterized from) are two
 *      hand-maintained copies of the same artwork. They have silently diverged
 *      before, leaving the site header showing a different logo from the
 *      installed app icon. Here the W's stroke geometry (5-point polyline),
 *      stroke width and line caps/joins are compared literally, and a
 *      reappearing <circle> (the earlier split-coin mark this design
 *      replaced) fails the build outright.
 *
 *   2. MISSING ARTIFACTS — manifest.json, app/layout.tsx, service-worker.js and
 *      mobile/app.json all reference asset paths by string. Nothing in the
 *      build fails when one of those files does not exist; the browser just
 *      404s and falls back to a blank icon. Every referenced path is resolved
 *      on disk, and every PNG's real pixel size is compared to the size its
 *      referrer advertises.
 *
 *   3. STORE / PLATFORM RULES — mobile/assets/icon.png must have no alpha
 *      channel, and maskable PWA icons must keep the mark inside the safe zone.
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();

const problems: string[] = [];
const checks: string[] = [];

function fail(message: string): void {
  problems.push(message);
}

function pass(message: string): void {
  checks.push(message);
}

function read(path: string): Promise<string> {
  return readFile(join(ROOT, path), 'utf8');
}

/**
 * Collect capture group 1 of every match. Written as an exec loop rather than
 * `[...source.matchAll()]` because tsconfig.json targets ES5 without
 * downlevelIteration, so spreading an iterator does not compile here.
 */
function allMatches(source: string, pattern: RegExp): string[] {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = global.exec(source)) !== null) {
    found.push(match[1]);
    if (match[0] === '') global.lastIndex += 1; // guard against zero-width matches
  }
  return found;
}

/** `[...new Set(x)]` equivalent that compiles under this repo's ES5 target. */
function unique(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

// ---------------------------------------------------------------------------
// 1. Glyph contract: Logo.tsx and the source marks must draw the same artwork
//
// The mark used to be a coin split by a seam (one <circle> + one <path>),
// and this file enforced that a letter W never reappeared — the two-chevron
// W that was explicitly rejected at the time. The owner has since reversed
// that call: the in-app logo must now MATCH the app icon, which is a W. So
// this check is repointed at the new geometry rather than removed outright —
// it still exists to catch the mark and its rasterization sources drifting
// apart, just against the new contract: a single 5-point <polyline> stroke
// (not a filled font glyph, not a multi-path chevron pair), and a hard
// rejection of any <circle> — the literal signal the old coin mark is back.
// ---------------------------------------------------------------------------

interface Glyph {
  /** Every <circle> in source order — the mark must have none; see checkGlyphContract. */
  circles: string[];
  /** Every W stroke element (<polyline> or <path>) as "points-or-d@strokeWidth@linecap@linejoin". */
  strokes: string[];
}

/** Collapse whitespace so point lists compare equal regardless of formatting. */
function normalizePoints(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * The W is a single stroked element — a <polyline points="..."> (preferred,
 * font-free by construction) or a <path d="M... L... L... L... L..."> using
 * the same 5-point shape. Geometry, stroke width AND line caps/joins are all
 * compared together — a file that kept the points but dropped the round caps
 * would still read as a different, more angular glyph.
 */
/**
 * Strip comments before scanning for tags. Several doc comments in this
 * repo — deliberately — spell out literal tag names like "<circle>" while
 * explaining what must never come back, and a bare tag-shaped regex would
 * "find" those mentions as real elements. Handles both JS/TS comments and
 * HTML/SVG comments since this is called on both file kinds.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/.*$/gm, '');
}

function extractGlyph(rawSource: string, label: string): Glyph {
  const source = stripComments(rawSource);
  const circles = allMatches(source, /<circle\b([^>]*)>/g);

  const getAttr = (attrs: string, name: string, kebab: string): string => {
    // Matches both JSX (strokeWidth="8") and plain SVG (stroke-width="8").
    const m = attrs.match(new RegExp(`\\b${kebab}="([^"]+)"`)) ?? attrs.match(new RegExp(`\\b${name}="([^"]+)"`));
    return m ? m[1].trim() : '-';
  };

  const strokeTags = [
    ...allMatches(source, /<polyline\b([^>]*)>/g).map((attrs) => ({ attrs, geomAttr: 'points' })),
    ...allMatches(source, /<path\b([^>]*)>/g)
      .filter((attrs) => /\bd="/.test(attrs))
      .map((attrs) => ({ attrs, geomAttr: 'd' })),
  ];

  const strokes = strokeTags.map(({ attrs, geomAttr }) => {
    const geom = getAttr(attrs, geomAttr, geomAttr);
    const strokeWidth = getAttr(attrs, 'strokeWidth', 'stroke-width');
    const linecap = getAttr(attrs, 'strokeLinecap', 'stroke-linecap');
    const linejoin = getAttr(attrs, 'strokeLinejoin', 'stroke-linejoin');
    return `${normalizePoints(geom)}@${strokeWidth}@${linecap}@${linejoin}`;
  });

  if (strokes.length === 0) fail(`${label}: could not find the W stroke (expected one <polyline> or <path>)`);
  return { circles, strokes };
}

/** A stroke's geometry field is a 5-point polyline: "x1,y1 x2,y2 x3,y3 x4,y4 x5,y5". */
function pointCount(stroke: string): number {
  const geom = stroke.split('@')[0];
  return geom.split(/\s+/).filter(Boolean).length;
}

const MARK_FILES = [
  'scripts/brand/mark.svg',
  'scripts/brand/mark-white.svg',
  'scripts/brand/mark-silhouette.svg',
];

async function checkGlyphContract(): Promise<void> {
  const logoSource = await read('components/Logo.tsx');
  const logo = extractGlyph(logoSource, 'components/Logo.tsx');

  // The old coin mark's defining feature was its <circle>. Zero tolerance for
  // it coming back, in any tone branch.
  if (logo.circles.length !== 0) {
    fail(`components/Logo.tsx: found ${logo.circles.length} <circle> element(s) — the old split-coin mark must not return`);
  } else {
    pass('components/Logo.tsx has no <circle> (the old split-coin mark has not returned)');
  }

  // Exactly one stroke element — the W. More than one is the signal someone
  // is rebuilding the letter as a multi-path chevron pair instead of the
  // single font-free polyline this design requires.
  if (logo.strokes.length !== 1) {
    fail(
      `components/Logo.tsx: expected exactly 1 W stroke element (<polyline> or <path>), found ${logo.strokes.length}: ${logo.strokes.join('  ')}\n` +
        `        The W must be one continuous stroke, not multiple chevron paths.`,
    );
  } else if (pointCount(logo.strokes[0]) !== 5) {
    fail(
      `components/Logo.tsx: the W stroke has ${pointCount(logo.strokes[0])} point(s), expected exactly 5 (the 5-point W shape)`,
    );
  } else {
    pass('components/Logo.tsx draws the W as a single 5-point stroke (not a two-chevron pair, not a filled font glyph)');
  }

  for (const file of MARK_FILES) {
    const mark = extractGlyph(await read(file), file);

    if (mark.circles.length !== 0) {
      fail(`${file}: found ${mark.circles.length} <circle> element(s) — the old split-coin mark must not return`);
      continue;
    }
    if (mark.strokes.join('|') !== logo.strokes.join('|')) {
      fail(
        `${file}: the W stroke has drifted from components/Logo.tsx\n` +
          `        Logo.tsx: ${logo.strokes.join('   ')}\n` +
          `        ${file}: ${mark.strokes.join('   ')}`,
      );
      continue;
    }
    pass(`${file} draws the same W glyph as components/Logo.tsx`);
  }

  // The silhouette feeds Android's alpha-only notification icon, so it must not
  // carry colour information that the OS would throw away. Strip any <mask>
  // block before looking for colour, in case a future revision reintroduces one.
  const silhouette = (await read('scripts/brand/mark-silhouette.svg')).replace(/<mask\b[\s\S]*?<\/mask>/g, '');
  const nonWhite = allMatches(silhouette, /(?:stroke|fill|stop-color)="(#[0-9a-fA-F]{3,8})"/g)
    .map((color) => color.toLowerCase())
    .filter((color) => color !== '#ffffff' && color !== '#fff');
  if (nonWhite.length > 0) {
    fail(
      `scripts/brand/mark-silhouette.svg: must be flat white for Android's alpha-only notification icon, found ${unique(nonWhite).join(', ')}`,
    );
  } else {
    pass('scripts/brand/mark-silhouette.svg is flat white');
  }
}

// ---------------------------------------------------------------------------
// 2. Every referenced asset exists, and PNGs are the size their referrer claims
// ---------------------------------------------------------------------------

interface AssetRef {
  /** Path relative to the repo root. */
  file: string;
  /** Where the reference was found, for the error message. */
  referrer: string;
  /** Expected square edge length in px, when the referrer declares one. */
  expectedSize?: number;
}

/** `/icons/foo.png` in a web referrer resolves to `public/icons/foo.png`. */
function webAsset(url: string): string {
  return join('public', url.replace(/^\//, ''));
}

async function collectRefs(): Promise<AssetRef[]> {
  const refs: AssetRef[] = [];

  // --- public/manifest.json ---
  const manifest = JSON.parse(await read('public/manifest.json')) as {
    icons?: { src: string; sizes?: string }[];
  };
  for (const icon of manifest.icons ?? []) {
    const edge = icon.sizes?.match(/^(\d+)x(\d+)$/);
    refs.push({
      file: webAsset(icon.src),
      referrer: 'public/manifest.json',
      expectedSize: edge ? Number(edge[1]) : undefined,
    });
  }

  // --- app/layout.tsx: the `icons` metadata block ---
  const layout = await read('app/layout.tsx');
  const iconsBlock = layout.match(/icons:\s*\{[\s\S]*?\n {2}\},/);
  if (!iconsBlock) {
    fail('app/layout.tsx: could not locate the `icons:` metadata block');
  } else {
    // Entries look like `{ url: "/icons/icon-16x16.png", sizes: "16x16", ... }`,
    // where `sizes` is optional — hence the second, optional capture group.
    const entryPattern = /url:\s*"([^"]+)"(?:,\s*sizes:\s*"([^"]+)")?/g;
    let entry: RegExpExecArray | null;
    while ((entry = entryPattern.exec(iconsBlock[0])) !== null) {
      const edge = entry[2] ? entry[2].match(/^(\d+)x(\d+)$/) : null;
      refs.push({
        file: webAsset(entry[1]),
        referrer: 'app/layout.tsx',
        expectedSize: edge ? Number(edge[1]) : undefined,
      });
    }
    // `shortcut: "/favicon.ico"` and other bare string entries.
    for (const url of allMatches(iconsBlock[0], /(?:shortcut|icon):\s*"([^"]+)"/g)) {
      refs.push({ file: webAsset(url), referrer: 'app/layout.tsx' });
    }
  }

  // --- app/layout.tsx: openGraph / twitter share images ---
  for (const url of unique(allMatches(layout, /"(\/og[^"]*\.(?:png|jpg|webp))"/g))) {
    refs.push({ file: webAsset(url), referrer: 'app/layout.tsx (openGraph)' });
  }

  // --- public/service-worker.js: precache list + notification icons ---
  const serviceWorker = await read('public/service-worker.js');
  for (const url of unique(allMatches(serviceWorker, /'(\/icons\/[^']+)'/g))) {
    refs.push({ file: webAsset(url), referrer: 'public/service-worker.js' });
  }

  // --- components + pages: any hardcoded /icons/ image src ---
  for (const file of ['components/Header.tsx', 'app/page.tsx']) {
    const source = await read(file);
    for (const url of unique(allMatches(source, /"(\/icons\/[^"]+)"/g))) {
      refs.push({ file: webAsset(url), referrer: file });
    }
  }

  // --- mobile/app.json: expo asset paths, relative to mobile/ ---
  const appJson = await read('mobile/app.json');
  for (const rel of unique(allMatches(appJson, /"(\.\/assets\/[^"]+)"/g))) {
    refs.push({ file: join('mobile', rel.replace(/^\.\//, '')), referrer: 'mobile/app.json' });
  }

  return refs;
}

async function checkAssets(): Promise<void> {
  const refs = await collectRefs();
  if (refs.length === 0) {
    fail('no asset references were found at all — the reference scanner is broken');
    return;
  }

  // De-duplicate, preferring the entry that carries an expected size.
  const byFile = new Map<string, AssetRef>();
  const files: string[] = [];
  for (const ref of refs) {
    const existing = byFile.get(ref.file);
    if (!existing) {
      byFile.set(ref.file, ref);
      files.push(ref.file);
    } else if (ref.expectedSize && !existing.expectedSize) {
      byFile.set(ref.file, ref);
    }
  }

  for (const ref of files.sort().map((file) => byFile.get(file)!)) {
    const absolute = join(ROOT, ref.file);

    let bytes: number;
    try {
      bytes = (await stat(absolute)).size;
    } catch {
      fail(`${ref.file} is referenced by ${ref.referrer} but does not exist`);
      continue;
    }
    if (bytes === 0) {
      fail(`${ref.file} is zero bytes (referenced by ${ref.referrer})`);
      continue;
    }

    if (ref.file.endsWith('.png')) {
      const { width, height } = await sharp(absolute).metadata();
      if (ref.expectedSize && (width !== ref.expectedSize || height !== ref.expectedSize)) {
        fail(
          `${ref.file} is ${width}x${height} but ${ref.referrer} declares ${ref.expectedSize}x${ref.expectedSize}`,
        );
        continue;
      }
      pass(`${ref.file} — ${width}x${height}, ${bytes} bytes`);
    } else {
      pass(`${ref.file} — ${bytes} bytes`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Store / platform requirements
// ---------------------------------------------------------------------------

async function checkPlatformRules(): Promise<void> {
  // App Store rejects an iOS app icon that carries an alpha channel.
  const iosIcon = 'mobile/assets/icon.png';
  try {
    const metadata = await sharp(join(ROOT, iosIcon)).metadata();
    if (metadata.hasAlpha) {
      fail(`${iosIcon} has an alpha channel — App Store submission will be rejected`);
    } else {
      pass(`${iosIcon} is fully opaque (App Store requirement)`);
    }
  } catch (error) {
    fail(`${iosIcon}: could not read image metadata — ${String(error)}`);
  }

  // Maskable icons get cropped to a centred circle of 80% diameter, so the four
  // corners are the first thing an installer throws away. If a corner is
  // near-white the mark has spilled out of the safe zone and will be clipped;
  // a correct maskable icon shows only the brand-blue background there.
  for (const maskable of [
    'public/icons/icon-maskable-192x192.png',
    'public/icons/icon-maskable-512x512.png',
  ]) {
    try {
      const { width = 0 } = await sharp(join(ROOT, maskable)).metadata();
      if (width === 0) {
        fail(`${maskable}: could not read image width`);
        continue;
      }
      const probe = Math.max(2, Math.round(width * 0.06));
      const corners = await Promise.all(
        [
          { left: 0, top: 0 },
          { left: width - probe, top: 0 },
          { left: 0, top: width - probe },
          { left: width - probe, top: width - probe },
        ].map((corner) =>
          sharp(join(ROOT, maskable))
            .extract({ ...corner, width: probe, height: probe })
            .stats(),
        ),
      );

      const bright = corners.filter((stats) =>
        stats.channels.slice(0, 3).every((channel) => channel.mean > 200),
      );
      if (bright.length > 0) {
        fail(
          `${maskable}: ${bright.length} corner(s) are near-white — the mark is outside the maskable safe zone and installers will clip it`,
        );
      } else {
        pass(`${maskable} keeps the mark inside the maskable safe zone`);
      }
    } catch (error) {
      fail(`${maskable}: could not inspect — ${String(error)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. The header actually renders the component
// ---------------------------------------------------------------------------

async function checkHeaderWiring(): Promise<void> {
  const header = await read('components/Header.tsx');

  if (!/from ['"](?:\.\/|@\/components\/)Logo['"]/.test(header)) {
    fail('components/Header.tsx does not import the Logo component');
    return;
  }
  if (!/<Logo\b/.test(header)) {
    fail('components/Header.tsx imports Logo but never renders it');
    return;
  }
  // The old header hand-rolled the mark as an <img> from /icons/ next to a
  // literal "WagerPals" span. Both are the Logo component's job now; a
  // reappearance means someone re-forked the brand in the header.
  if (/<img[^>]*\/icons\//.test(header)) {
    fail('components/Header.tsx still renders the logo as a raw <img> from /icons/');
    return;
  }
  pass('components/Header.tsx renders <Logo>');
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await checkGlyphContract();
  await checkAssets();
  await checkPlatformRules();
  await checkHeaderWiring();

  for (const check of checks) console.log(`  ok  ${check}`);

  if (problems.length > 0) {
    console.error(`\nBrand verification FAILED — ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  --  ${problem}`);
    console.error('\nIf the artwork changed on purpose, re-run `npm run brand:assets`.');
    process.exitCode = 1;
    return;
  }

  console.log(`\nBrand verification passed: ${checks.length} checks, 0 problems.`);
}

main().catch((error) => {
  console.error('\nUnexpected error while verifying brand assets:');
  console.error(error);
  process.exitCode = 1;
});
