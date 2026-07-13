// WagerPals — light, modern, Polymarket-like theme for the mobile app.
// Mirrors the web light design system (near-white canvas, white cards,
// hairline borders, blue accent). Token names are kept from the previous
// dark theme so existing screens keep compiling; only the values changed.
// Import { colors, radius, spacing, glass, gradients } from '../theme'.

export const colors = {
  // Base canvas
  bg: '#FFFFFF',
  bg2: '#F7F8FA',
  // Card / panel surfaces
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceGlass: 'rgba(15,23,42,0.04)',
  surfaceGlassStrong: 'rgba(15,23,42,0.06)',
  // Hairline borders
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  // Text
  text: '#1E2530',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',
  // Brand blue ramp
  brand1: '#3B82F6',
  brand2: '#2563EB',
  brand3: '#1D4ED8',
  brand: '#2563EB',
  // Accents (names kept from the dark theme; values are now light-palette)
  violet: '#4F46E5',
  cyan: '#0EA5E9',
  mint: '#16A34A', // yes / win / positive
  rose: '#DC2626', // no / loss / danger
  amber: '#D97706', // pending
  // Translucent accent fills
  mintFill: 'rgba(22,163,74,0.08)',
  roseFill: 'rgba(220,38,38,0.08)',
  brandFill: 'rgba(37,99,235,0.08)',
  cyanFill: 'rgba(14,165,233,0.08)',
  white: '#ffffff',
} as const;

export const gradients = {
  brand: ['#3B82F6', '#2563EB', '#1D4ED8'] as const, // blue ramp
  cool: ['#0EA5E9', '#2563EB'] as const,
  mint: ['#22C55E', '#16A34A'] as const,
  rose: ['#EF4444', '#DC2626'] as const,
  card: ['#FFFFFF', '#F9FAFB'] as const, // near-flat white
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
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

export default { colors, gradients, radius, spacing, glass, glow, inputStyle };
