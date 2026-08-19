// WagerPals — "The Board" mobile theme. Mirrors the web light design system
// shipped in app/globals.css (Paper/Ink/Emerald/Crimson/Amber — see
// DESIGN-SPEC.md and the mobile addendum). Data (odds/stakes) reads
// sportsbook-precise in IBM Plex Mono; people (avatars/reactions) read
// friend-chaos-warm in Amber. Amber never touches a money value.
// Import { colors, radius, spacing, glass, gradients, font } from '../theme'.
//
// --- Canonical token layer -------------------------------------------------
// `tokens` below mirrors, name for name, the CSS custom properties defined
// in the web app's app/globals.css. The two files encode the SAME design
// values and must always be changed together — if a value changes on one
// side, mirror it on the other in the same commit.
//
// Naming rule (web CSS var -> mobile token path), kebab-case -> camelCase:
//   --color-paper               -> tokens.color.paper
//   --color-ink                 -> tokens.color.ink
//   --color-emerald             -> tokens.color.emerald
//   --color-crimson-ink         -> tokens.color.crimsonInk
//   --color-amber-fill          -> tokens.color.amberFill
//   --space-4                   -> tokens.space[4]
//   --radius-card               -> tokens.radius.card
//   --shadow-elev-2             -> tokens.shadow.elev2
//   --duration-bar              -> tokens.duration.bar
//
// Contrast rule (measured the same way as app/globals.css — see that file's
// header comment): Emerald passes AA as text on both Paper and Card as-is.
// Crimson and Amber's canonical hexes do NOT pass small-text contrast — they
// are for FILLS, BARS, RINGS and LARGE NUMERALS only. Anywhere a canonical
// crimson/amber value would sit UNDER text (buttons, pill labels, error
// copy, destructive rows, "loss" money) it must use the darker `*Ink` twin
// instead. This file encodes that as two layers: `tokens.color.crimson` /
// `tokens.color.amber` are the vivid canonical values (bars, rings, large
// numerals, translucent fills); `tokens.color.crimsonInk` /
// `tokens.color.amberInk` are the text-safe twins. The legacy aliases below
// (`colors.rose`, `colors.amber`, `colors.pending`, ...) point at the
// text-safe twins by default, since that is how nearly every existing call
// site actually uses them (label/icon foreground) — call sites that
// specifically want a vivid bar/ring fill (the confidence bar, Avatar's
// ring) reach for the canonical `tokens.color.crimson` / `.amber` directly.
//
// All the legacy exports below (`colors`, `gradients`, `radius`, `spacing`,
// `glass`, `glow`, `inputStyle`) keep their exact names and shapes —
// ~15 screens import them directly — only the values changed. Where a
// legacy value happens to be byte-identical to a canonical token, it is
// re-pointed at the same hex so the two layers can't drift silently; every
// such re-point is called out in the surrounding comments.

export const tokens = {
  color: {
    // ---- Canonical palette (mirrors app/globals.css :root) ----------------
    paper: '#FAF7F0', // page canvas — warm off-white, never stark white
    card: '#FFFFFF', // crisp white card surface, sits ON paper
    ink: '#1C1B17', // primary text — warm near-black, never pure #000000
    inkSecondary: '#575448',
    inkMuted: '#747060',
    inkInverse: '#FFFFFF',
    // Emerald — favor / winning side / positive stakes / primary CTA.
    // Passes AA as text as-is on both paper and card.
    emerald: '#0F7A4C',
    emeraldHover: '#0C5F3B',
    emeraldFill: 'rgba(15, 122, 76, 0.10)',
    // Crimson — against / losing side / negative stakes. The canonical hex
    // is FILLS/BARS/RINGS/LARGE NUMERALS ONLY (measures under the 4.5:1
    // body-text floor) — small crimson text/icons use crimsonInk.
    crimson: '#D64545',
    crimsonHover: '#CF2E2E',
    crimsonInk: '#D23333', // text-safe twin
    crimsonFill: 'rgba(214, 69, 69, 0.10)',
    // Amber — the "human" accent: avatar rings, reaction chips, badges.
    // NEVER used for money. The canonical hex fails even the 3:1 large-text
    // bar — FILLS, RINGS and BADGE BACKDROPS ONLY. Small amber text/icons
    // use amberInk.
    amber: '#F2A93B',
    amberHover: '#F09C1E',
    amberInk: '#9D630A', // text-safe twin
    amberFill: 'rgba(242, 169, 59, 0.15)',
    // Line — hairline borders, dividers. Not text-bearing.
    line: '#E7E2D6',
    lineStrong: '#978F74', // real 3:1 non-text boundary (input borders)
    // Neutral "informational" tone — pre-existing badges that describe
    // neither money nor a person (Public / Creator / Free points).
    infoInk: '#0A76B2', // text-safe twin
    // "Gold" — money that has been WON. Deliberately NOT amber: amber is
    // reserved for people and must never touch a money value.
    gold: '#D87606',
    goldInk: '#92400E',
    goldFill: 'rgba(216, 118, 6, 0.12)',
    // Ink that sits on a filled Emerald surface (primary CTA, solid pills).
    onEmerald: '#FFFFFF',
    onCta: '#FFFFFF',
    ctaFrom: '#0F7A4C',
    ctaTo: '#0C5F3B',

    // ---- Legacy key names — kept so existing components/screens keep
    // compiling unchanged; every value below is one of the canonical hexes
    // above, just re-pointed onto the old shape. ---------------------------
    surface: '#FFFFFF', // = card
    surfaceElevated: '#FFFFFF', // = card
    surfaceSunken: '#F1ECE1', // = web --color-surface-sunken
    border: '#E7E2D6', // = line
    borderStrong: '#978F74', // = lineStrong
    text: '#1C1B17', // = ink
    textSecondary: '#575448', // = inkSecondary
    textMuted: '#747060', // = inkMuted
    textInverse: '#FFFFFF',
    accent: '#0F7A4C', // = emerald — passes as text/foreground as-is
    accentHover: '#0C5F3B',
    accentSoft: '#0F7A4C',
    accentFill: 'rgba(15, 122, 76, 0.10)',
    yes: '#0F7A4C',
    yesFill: 'rgba(15, 122, 76, 0.10)',
    no: '#D23333', // text-safe crimsonInk default — see header comment
    noFill: 'rgba(214, 69, 69, 0.10)',
    win: '#0F7A4C',
    loss: '#D23333',
    pending: '#9D630A', // text-safe amberInk default — see header comment
    pendingFill: 'rgba(242, 169, 59, 0.15)',
    info: '#0A76B2', // text-safe infoInk default
    infoFill: 'rgba(11, 127, 191, 0.10)',
  },
  fontSize: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72 },
  lineHeight: { xs: 16, sm: 20, base: 24, lg: 28, xl: 28, '2xl': 32, '3xl': 36, '4xl': 40, '5xl': 48, '6xl': 60, '7xl': 72 },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96 },
  // Structured elements (cards, buttons, inputs) are crisp 8-12px; only
  // avatars, reaction chips and status pills are fully rounded (pill).
  radius: { chip: 8, control: 8, card: 10, panel: 12, pill: 9999 },
  shadow: {
    elev1: { shadowColor: '#1C1B17', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
    elev2: { shadowColor: '#1C1B17', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
    elev3: { shadowColor: '#1C1B17', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.10, shadowRadius: 16, elevation: 4 },
    elev4: { shadowColor: '#1C1B17', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.14, shadowRadius: 32, elevation: 8 },
    accent: { shadowColor: '#0F7A4C', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
  },
  duration: { instant: 100, fast: 150, base: 220, slow: 360, slower: 600, bar: 400 },
  easing: { out: 'cubic-bezier(0.16, 1, 0.3, 1)', inOut: 'cubic-bezier(0.65, 0, 0.35, 1)', spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
} as const;

export type Tokens = typeof tokens;

// Raw control points for the web easing curves above, for React Native's
// `Easing.bezier(x1, y1, x2, y2)` (RN has no CSS-string easing support).
export const easingBezier = {
  out: [0.16, 1, 0.3, 1],
  inOut: [0.65, 0, 0.35, 1],
  spring: [0.34, 1.56, 0.64, 1],
} as const;

// --- Type roles --------------------------------------------------------
// Three families, never collapsed to one: numbers/odds get IBM Plex Mono
// (never above weight 500 — RN has no font-variant-numeric, but Plex Mono
// is monospaced so numerals are inherently tabular); headlines/wordmark get
// Archivo Black, sparingly; body/names/comments/buttons get Plus Jakarta
// Sans. Screens should reference these tokens rather than font-family string
// literals, mirroring how `colors`/`radius`/`spacing` are consumed. Loaded
// via useFonts in App.tsx — see that file for the loading gate.
export const font = {
  display: 'ArchivoBlack_400Regular',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium', // Plex Mono never renders above 500
  sans: 'PlusJakartaSans_400Regular',
  sansMedium: 'PlusJakartaSans_500Medium',
  sansSemiBold: 'PlusJakartaSans_600SemiBold',
} as const;

export type Font = typeof font;

export const colors = {
  // Base canvas
  bg: tokens.color.paper, // '#FAF7F0' — page canvas, warm off-white
  bg2: tokens.color.surfaceSunken, // '#F1ECE1'
  // Card / panel surfaces
  surface: tokens.color.surface, // '#FFFFFF'
  surfaceElevated: tokens.color.surfaceElevated, // '#FFFFFF'
  surfaceGlass: 'rgba(28,27,23,0.04)',
  surfaceGlassStrong: 'rgba(28,27,23,0.06)',
  // Hairline borders
  border: tokens.color.border, // '#E7E2D6'
  borderStrong: tokens.color.borderStrong, // '#978F74'
  // Text
  text: tokens.color.text, // '#1C1B17'
  textMuted: tokens.color.textSecondary, // '#575448' — identical to tokens.color.textSecondary
  textFaint: tokens.color.textMuted, // '#747060' — identical to tokens.color.textMuted (name collision with the local `textMuted` above is intentional/pre-existing)
  // Emerald ramp (primary brand / CTA)
  brand1: tokens.color.accentSoft, // '#0F7A4C'
  brand2: tokens.color.accent, // '#0F7A4C'
  brand3: tokens.color.accentHover, // '#0C5F3B'
  brand: tokens.color.accent, // '#0F7A4C'
  // Accents (names kept from earlier themes; values now on the Paper system)
  violet: '#6E5BC4',
  cyan: tokens.color.infoInk, // '#0A76B2' — text-safe info twin
  mint: tokens.color.win, // '#0F7A4C' — yes / win / positive, text-safe as-is
  rose: tokens.color.loss, // '#D23333' — no / loss / danger, text-safe crimsonInk
  amber: tokens.color.amberInk, // '#9D630A' — text-safe amber twin (labels/icons)
  gold: tokens.color.goldInk, // '#92400E' — won-money tone, distinct from amber
  // Vivid canonical tones — fills, bars, rings, large numerals ONLY. Never
  // put text directly on Paper/Card in these colors; use the *Ink twins
  // above (rose/amber/gold) for that.
  emeraldBright: tokens.color.emerald, // '#0F7A4C'
  crimsonBright: tokens.color.crimson, // '#D64545'
  amberBright: tokens.color.amber, // '#F2A93B'
  goldBright: tokens.color.gold, // '#D87606'
  // Translucent accent fills
  mintFill: tokens.color.yesFill, // 'rgba(15,122,76,0.10)'
  roseFill: tokens.color.noFill, // 'rgba(214,69,69,0.10)'
  brandFill: tokens.color.accentFill, // 'rgba(15,122,76,0.10)'
  cyanFill: tokens.color.infoFill, // 'rgba(11,127,191,0.10)'
  violetFill: 'rgba(110,91,196,0.08)',
  amberFill: tokens.color.amberFill, // 'rgba(242,169,59,0.15)'
  goldFill: tokens.color.goldFill, // 'rgba(216,118,6,0.12)'
  // NOTE: white is intentionally NOT re-pointed at tokens.color.card —
  // '#ffffff' (lowercase) is not byte-identical to '#FFFFFF' (uppercase).
  white: '#ffffff',
} as const;

export const gradients = {
  brand: ['#3FA073', '#0F7A4C', '#0C5F3B'] as const, // emerald ramp
  cool: ['#0A76B2', '#0F7A4C'] as const,
  mint: ['#3FA073', '#0F7A4C'] as const,
  rose: ['#D64545', '#CF2E2E'] as const,
  card: ['#FFFFFF', '#FAF7F0'] as const, // white card fading toward paper
} as const;

export const radius = {
  sm: tokens.radius.chip, // 8
  md: tokens.radius.control, // 8
  lg: tokens.radius.card, // 10
  xl: tokens.radius.panel, // 12
  pill: tokens.radius.pill, // 9999
} as const;

export const spacing = {
  xs: tokens.space[1], // 4
  sm: tokens.space[2], // 8
  md: tokens.space[3], // 12
  lg: tokens.space[4], // 16
  xl: tokens.space[6], // 24
  xxl: tokens.space[8], // 32
} as const;

// Reusable style fragments — white cards with hairline borders + soft shadow
export const glass = {
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    shadowColor: '#1C1B17',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardStrong: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xl,
    shadowColor: '#1C1B17',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
} as const;

// Subtle neutral shadow (iOS). The color argument is kept for API
// compatibility but no longer tints the shadow — no neon glows, warm-ink
// shadow only.
export const glow = (_color: string, opacity = 0.08) => ({
  shadowColor: '#1C1B17',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: Math.min(opacity, 0.1),
  shadowRadius: 8,
  elevation: 2,
});

// Standard text-input styling for light forms.
export const inputStyle = {
  backgroundColor: colors.white,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: radius.md,
  color: colors.text,
  paddingHorizontal: 14,
  paddingVertical: 12,
  fontSize: 16,
} as const;

export default { colors, gradients, radius, spacing, glass, glow, inputStyle, tokens, easingBezier, font };
