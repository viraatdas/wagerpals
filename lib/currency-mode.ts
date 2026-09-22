/**
 * Currency mode — whether a wager stakes real dollars or play-money points.
 *
 * WHY THIS EXISTS: App Review rejected 1.1.0 and, under Guideline 2.3.6, forced
 * the age rating to declare Gambling = Yes. That declaration pulls the app under
 * Guideline 5.3.4:
 *
 *   "Apps that offer real money gaming ... must have necessary licensing and
 *    permissions in the locations where the app is used, must be geo-restricted
 *    to those locations, and must be free on the App Store."
 *
 * WagerPals holds no gambling licence anywhere, and US licensing is
 * state-by-state. No wording of the listing changes that — the reviewer
 * classified the app from the binary. So the App Store build stakes POINTS, not
 * dollars. With no way to put real money in, nothing staked is real money, 5.3.4
 * does not apply, and neither does 5.1.1(ix)'s organization-account requirement.
 *
 * WHAT IT DOES NOT DO: this is deliberately a GLOBAL, server-side switch, not a
 * per-client or per-reviewer one. Showing App Review a play-money app while real
 * users stake dollars would be exactly the hidden-functionality trick Guideline
 * 2.3.1 forbids, and it would be dishonest besides. Every caller of the API —
 * web, iOS, iMessage — sees the same mode.
 *
 * The money engine in lib/payments.ts is untouched and stays exactly as it is.
 * Its arithmetic (escrow, settlement, idempotency, the guarded debit) is
 * currency-agnostic; only the RAILS in and out are gated. Flip this back to
 * 'usd' and real money works again, so a future licensed build needs no rewrite.
 */

export type CurrencyMode = 'usd' | 'points';

/**
 * Defaults to 'usd' so nothing changes for a deployment that has not opted in.
 * Production sets WAGER_CURRENCY_MODE=points.
 */
export function currencyMode(): CurrencyMode {
  return process.env.WAGER_CURRENCY_MODE === 'points' ? 'points' : 'usd';
}

export function isPointsMode(): boolean {
  return currencyMode() === 'points';
}

/** Error payload for a real-money rail that is closed in points mode. */
export const CASH_RAILS_CLOSED = {
  error: 'WagerPals wagers are played for points. There is nothing to add or cash out.',
  code: 'CASH_RAILS_CLOSED' as const,
};
