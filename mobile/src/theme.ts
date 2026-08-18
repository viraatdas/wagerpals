// WagerPals — light, modern, Polymarket-like theme for the mobile app.
// Mirrors the web light design system (near-white canvas, white cards,
// hairline borders, blue accent). Token names are kept from the previous
// dark theme so existing screens keep compiling; only the values changed.
// Import { colors, radius, spacing, glass, gradients } from '../theme'.
//
// --- Canonical token layer -------------------------------------------------
// `tokens` below mirrors, name for name, the CSS custom properties defined
// in the web app's app/globals.css. The two files encode the SAME design
// values and must always be changed together — if a value changes on one
// side, mirror it on the other in the same commit.
//
// Naming rule (web CSS var -> mobile token path), kebab-case -> camelCase:
//   --color-surface            -> tokens.color.surface
//   --color-surface-elevated   -> tokens.color.surfaceElevated
//   --space-4                  -> tokens.space[4]
//   --radius-card              -> tokens.radius.card
//   --shadow-elev-2            -> tokens.shadow.elev2
//   --duration-fast            -> tokens.duration.fast
//
// All the legacy exports below (`colors`, `gradients`, `radius`, `spacing`,
// `glass`, `glow`, `inputStyle`) are UNCHANGED and keep their exact names,
// shapes and values — ~15 screens import them directly. Where a legacy value
// happens to be byte-identical to a canonical token, it is re-pointed at the
// token so the two layers can't drift silently; every such re-point is a
// verified no-op (see the values called out in the surrounding comments).

export const tokens = {
  color: {
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    surfaceSunken: '#F7F8FA',
    border: '#E5E7EB',
    borderStrong: '#D1D5DB',
    text: '#1E2530',
    textSecondary: '#6B7280',
    textMuted: '#9CA3AF',
    textInverse: '#FFFFFF',
    // Phosphor-green brand, tuned for THIS light surface. The web's #24E17A is
    // only 1.7:1 on white and cannot carry text here, so the accent is the deep
    // end of the same ramp (white label on it = 4.8:1) and the bright value is
    // kept for fills and graphics. The iOS app keeps its light background until
    // its own dark pass — see PRODUCT.md §Platform — but the BRAND colour has to
    // match the icon set, which is green.
    accent: '#0A7C43',
    accentHover: '#075C32',
    accentSoft: '#12B45E',
    accentFill: 'rgba(36,225,122,0.14)',
    yes: '#16A34A',
    yesFill: 'rgba(22,163,74,0.08)',
    no: '#DC2626',
    noFill: 'rgba(220,38,38,0.08)',
    win: '#16A34A',
    loss: '#DC2626',
    pending: '#D97706',
    pendingFill: 'rgba(217,119,6,0.08)',
    info: '#0284C7',
    infoFill: 'rgba(2,132,199,0.08)',
  },
  fontSize: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72 },
  lineHeight: { xs: 16, sm: 20, base: 24, lg: 28, xl: 28, '2xl': 32, '3xl': 36, '4xl': 40, '5xl': 48, '6xl': 60, '7xl': 72 },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96 },
  radius: { chip: 10, control: 16, card: 22, panel: 28, pill: 9999 },
  shadow: {
    elev1: { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
    elev2: { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2 },
    elev3: { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4 },
    elev4: { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.14, shadowRadius: 32, elevation: 8 },
    accent: { shadowColor: '#0A7C43', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
  },
  duration: { instant: 100, fast: 150, base: 220, slow: 360, slower: 600 },
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

export const colors = {
  // Base canvas
  bg: tokens.color.surface, // '#FFFFFF' — identical to tokens.color.surface
  bg2: tokens.color.surfaceSunken, // '#F7F8FA' — identical to tokens.color.surfaceSunken
  // Card / panel surfaces
  surface: tokens.color.surface, // '#FFFFFF'
  surfaceElevated: tokens.color.surfaceElevated, // '#FFFFFF'
  surfaceGlass: 'rgba(15,23,42,0.04)',
  surfaceGlassStrong: 'rgba(15,23,42,0.06)',
  // Hairline borders
  border: tokens.color.border, // '#E5E7EB'
  borderStrong: tokens.color.borderStrong, // '#D1D5DB'
  // Text
  text: tokens.color.text, // '#1E2530'
  textMuted: tokens.color.textSecondary, // '#6B7280' — identical to tokens.color.textSecondary
  textFaint: tokens.color.textMuted, // '#9CA3AF' — identical to tokens.color.textMuted (name collision with the local `textMuted` above is intentional/pre-existing)
  // Brand green ramp
  brand1: tokens.color.accentSoft, // '#12B45E'
  brand2: tokens.color.accent, // '#0A7C43'
  brand3: tokens.color.accentHover, // '#075C32'
  brand: tokens.color.accent, // '#0A7C43'
  // Accents (names kept from the dark theme; values are now light-palette)
  violet: '#4F46E5',
  // NOTE: cyan is intentionally NOT re-pointed at tokens.color.info — the
  // values differ ('#0EA5E9' vs '#0284C7'). Keep them distinct.
  cyan: '#0EA5E9',
  mint: '#16A34A', // yes / win / positive — matches both tokens.color.yes and tokens.color.win; left literal to avoid picking one
  rose: '#DC2626', // no / loss / danger — matches both tokens.color.no and tokens.color.loss; left literal to avoid picking one
  amber: tokens.color.pending, // '#D97706'
  // Translucent accent fills
  mintFill: tokens.color.yesFill, // 'rgba(22,163,74,0.08)'
  roseFill: tokens.color.noFill, // 'rgba(220,38,38,0.08)'
  brandFill: tokens.color.accentFill, // 'rgba(36,225,122,0.14)'
  // NOTE: cyanFill is intentionally NOT re-pointed at tokens.color.infoFill —
  // the values differ ('rgba(14,165,233,0.08)' vs 'rgba(2,132,199,0.08)').
  cyanFill: 'rgba(14,165,233,0.08)',
  violetFill: 'rgba(79,70,229,0.08)',
  amberFill: tokens.color.pendingFill, // 'rgba(217,119,6,0.08)'
  // NOTE: white is intentionally NOT re-pointed at tokens.color.surface —
  // '#ffffff' (lowercase) is not byte-identical to '#FFFFFF' (uppercase).
  white: '#ffffff',
} as const;

export const gradients = {
  brand: ['#12B45E', '#0A7C43', '#075C32'] as const, // green ramp
  cool: ['#0EA5E9', '#0A7C43'] as const,
  mint: ['#22C55E', '#16A34A'] as const,
  rose: ['#EF4444', '#DC2626'] as const,
  card: ['#FFFFFF', '#F9FAFB'] as const, // near-flat white
} as const;

export const radius = {
  sm: tokens.radius.chip, // 10
  md: tokens.radius.control, // 16
  lg: tokens.radius.card, // 22
  xl: tokens.radius.panel, // 28
  // NOTE: pill is intentionally NOT re-pointed at tokens.radius.pill — the
  // values differ (999 vs 9999).
  pill: 999,
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
    shadowColor: '#0F172A',
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
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
} as const;

// Subtle neutral shadow (iOS). The color argument is kept for API
// compatibility but no longer tints the shadow — no neon glows in light mode.
export const glow = (_color: string, opacity = 0.08) => ({
  shadowColor: '#0F172A',
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

export default { colors, gradients, radius, spacing, glass, glow, inputStyle, tokens, easingBezier };
