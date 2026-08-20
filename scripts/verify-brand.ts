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
 *      installed app icon. Here the path data, stroke width and coin geometry
 *      are compared literally.
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
// ---------------------------------------------------------------------------

/** Collapse whitespace so `M6,13 L18,52` and `M6,13  L18,52` compare equal. */
function normalizePath(d: string): string {
  return d.trim().replace(/\s+/g, ' ');
}

interface Glyph {
  /** Every <circle> in source order, as "cx,cy,r@strokeWidth". */
  circles: string[];
  /** Any <path d="...">. The mark must have none — see checkGlyphContract. */
  paths: string[];
}

/**
 * The mark is one <circle> (the open half's ring) plus one <path> (the solid
 * half). Comparing the whole ordered list of each — geometry AND stroke width
 * together — is what actually catches drift; a per-attribute comparison would
 * pass a file that changed the radius but kept the stroke.
 */
function extractGlyph(source: string, label: string): Glyph {
  const circles = allMatches(source, /<circle\b([^>]*)>/g).map((attrs) => {
    const get = (name: string): string => {
      // Matches both JSX (strokeWidth="7") and plain SVG (stroke-width="7").
      const m = attrs.match(new RegExp(`\\b${name}="([^"]+)"`));
      return m ? m[1].trim() : '-';
    };
    const sw = get('stroke-width') !== '-' ? get('stroke-width') : get('strokeWidth');
    return `${get('cx')},${get('cy')},${get('r')}@${sw}`;
  });
  if (circles.length === 0) fail(`${label}: could not find any coin <circle>`);
  return {
    circles,
    paths: allMatches(source, /\bd="([^"]+)"/g).map(normalizePath),
  };
}

const MARK_FILES = [
  'scripts/brand/mark.svg',
  'scripts/brand/mark-white.svg',
  'scripts/brand/mark-silhouette.svg',
];

async function checkGlyphContract(): Promise<void> {
  const logoSource = await read('components/Logo.tsx');
  const logo = extractGlyph(logoSource, 'components/Logo.tsx');

  if (logo.circles.length !== 1) {
    fail(`components/Logo.tsx: expected exactly 1 <circle> (the open half's ring), found ${logo.circles.length}`);
  }
  // Exactly one path — the solid half. The rejected mark drew the two sides of a
  // W as a PAIR of <path> chevrons, so a second path reappearing here is the
  // signal that someone has started rebuilding it.
  if (logo.paths.length !== 1) {
    fail(
      `components/Logo.tsx: expected exactly 1 <path> (the solid half), found ${logo.paths.length}: ${logo.paths.join('  ')}\n` +
        `        The two-chevron letter-W mark was explicitly rejected and must not return.`,
    );
  } else {
    pass('components/Logo.tsx draws one coin split by a seam (not a two-chevron W)');
  }

  for (const file of MARK_FILES) {
    const mark = extractGlyph(await read(file), file);

    if (mark.circles.join('|') !== logo.circles.join('|')) {
      fail(
        `${file}: coin geometry has drifted from components/Logo.tsx\n` +
          `        Logo.tsx: ${logo.circles.join('   ')}\n` +
          `        ${file}: ${mark.circles.join('   ')}`,
      );
      continue;
    }
    if (mark.paths.join('|') !== logo.paths.join('|')) {
      fail(
        `${file}: the solid half's path has drifted from components/Logo.tsx\n` +
          `        Logo.tsx: ${logo.paths.join('   ')}\n` +
          `        ${file}: ${mark.paths.join('   ')}`,
      );
      continue;
    }
    pass(`${file} draws the same glyph as components/Logo.tsx`);
  }

  // The silhouette feeds Android's alpha-only notification icon, so it must not
  // carry colour information that the OS would throw away.
  // The <mask> block legitimately uses black — that is the knockout that cuts the
  // link gap, and it is exactly what makes this glyph survive alpha-only masking.
  // Strip masks before looking for colour in the drawn artwork.
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
