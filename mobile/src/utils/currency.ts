// Currency mode for the app's display layer — the client half of
// `lib/currency-mode.ts` on the server.
//
// WHY: App Review forced the age rating to declare Gambling = Yes under
// Guideline 2.3.6, which pulls the app under 5.3.4 — real money gaming needs
// licensing in every location the app is used, geo-restriction to those
// locations, and WagerPals holds no licence anywhere. So wagers are played for
// POINTS. The server closes the deposit and withdraw rails
// (`WAGER_CURRENCY_MODE=points`); this module makes the UI tell the truth about
// what it is showing.
//
// DEFAULTS TO POINTS ON PURPOSE. A build that forgets to set
// EXPO_PUBLIC_CURRENCY_MODE renders points and hides the cash rails, which is
// the safe direction: the failure mode of a missing env var is an app that
// under-claims, never one that advertises real-money betting to App Review.
// Set EXPO_PUBLIC_CURRENCY_MODE=usd explicitly for a future licensed build.

export type CurrencyMode = 'usd' | 'points';

export const CURRENCY_MODE: CurrencyMode =
  process.env.EXPO_PUBLIC_CURRENCY_MODE === 'usd' ? 'usd' : 'points';

export const IS_POINTS = CURRENCY_MODE === 'points';

/** "12", "12.5" — trailing zeros stripped so whole points read cleanly. */
export function formatPointsNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '');
}

/** Unit label, singular where it reads better. */
export function pointsLabel(value: number): string {
  return Math.abs(value) === 1 ? 'pt' : 'pts';
}
