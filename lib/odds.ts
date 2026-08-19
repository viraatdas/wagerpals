// Pure, framework-free helpers that turn raw bet totals into the display
// primitives the board, detail view, and activity feed all share: the
// confidence split, the odds ratio, and stake formatting.
//
// Mirrors the isomorphic convention already established by lib/comments.ts:
// no 'server-only', no next/*, no @/lib/db, no Node builtins, no React. It
// is imported by both server route handlers/pages and 'use client'
// components, so it must stay pure and synchronous.

// ---------------------------------------------------------------------------
// Confidence split
// ---------------------------------------------------------------------------

export interface ConfidenceSplit {
  /** Integer percent for side A, 0-100. */
  pctA: number;
  /** Integer percent for side B, 0-100. Always exactly `100 - pctA`. */
  pctB: number;
}

/**
 * Splits two pool totals into whole-number percentages that always sum to
 * exactly 100.
 *
 * Rounding decision: `pctB` is computed as the *complement* of `pctA`
 * (`100 - pctA`), not as an independently-rounded `round(bTotal / pool *
 * 100)`. Two independently-rounded percentages can drift to 99 or 101 (e.g.
 * 33.5 / 66.5 both round up to 34 / 67). Taking the complement guarantees
 * the pair always sums to exactly 100, regardless of which way the single
 * rounding falls.
 *
 * A pool with nothing staked on either side has no lean yet, so it rests at
 * an even 50/50 split rather than an arbitrary 0/100 or NaN.
 */
export function splitPercent(aTotal: number, bTotal: number): ConfidenceSplit {
  const a = Math.max(0, aTotal || 0);
  const b = Math.max(0, bTotal || 0);
  const pool = a + b;

  if (pool <= 0) {
    return { pctA: 50, pctB: 50 };
  }

  const pctA = Math.round((a / pool) * 100);
  return { pctA, pctB: 100 - pctA };
}

// ---------------------------------------------------------------------------
// Odds ratio
// ---------------------------------------------------------------------------

export interface OddsRatioParts {
  /** Reduced integer for side A as a string, or "" when no ratio can be formed. */
  a: string;
  /** Reduced integer for side B as a string, or "" when no ratio can be formed. */
  b: string;
}

const EMPTY_RATIO: OddsRatioParts = { a: '', b: '' };

function gcd(x: number, y: number): number {
  let a = Math.abs(Math.round(x));
  let b = Math.abs(Math.round(y));
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}

/**
 * Approximates `ca : cb` with the closest ratio whose terms are capped at
 * `maxTerm`, by scanning candidate denominators 1..maxTerm and keeping the
 * one whose implied numerator lands closest to the true ratio.
 *
 * Rounding decision: real stake totals are rarely exact small multiples of
 * each other. A GCD reduction of, say, $47 vs $53 in cents stays 47:53 —
 * two coprime numbers with no smaller equivalent. Rather than show that
 * unreadable ratio verbatim, this picks the "closest simple odds" a
 * sportsbook would actually quote.
 */
function approximateRatio(ca: number, cb: number, maxTerm: number): [number, number] {
  const ratio = ca / cb;
  let bestP = Math.max(1, Math.round(ratio));
  let bestQ = 1;
  let bestError = Math.abs(bestP / bestQ - ratio);

  for (let q = 1; q <= maxTerm; q++) {
    const p = Math.max(1, Math.round(ratio * q));
    const error = Math.abs(p / q - ratio);
    if (error < bestError) {
      bestError = error;
      bestP = p;
      bestQ = q;
    }
  }

  const g = gcd(bestP, bestQ);
  return [bestP / g, bestQ / g];
}

/**
 * Reduces two pool totals to the smallest whole-number ratio that
 * represents them (e.g. $120 vs $40 -> "3":"1"). Works in integer cents so
 * fractional dollar totals compare exactly instead of drifting on floating
 * point division.
 *
 * A side with nothing staked on it has no finite odds against the other
 * side (division by zero), so both an empty pool and a one-sided-empty pool
 * fall back to an empty pair rather than showing "Infinity" or a misleading
 * "0" — callers should skip rendering the ratio entirely in that case.
 */
export function reducedOddsRatio(aTotal: number, bTotal: number): OddsRatioParts {
  const a = Math.max(0, aTotal || 0);
  const b = Math.max(0, bTotal || 0);
  if (a <= 0 || b <= 0) return EMPTY_RATIO;

  const CENTS = 100;
  let ca = Math.round(a * CENTS);
  let cb = Math.round(b * CENTS);
  const g = gcd(ca, cb);
  ca = ca / g;
  cb = cb / g;

  const MAX_TERM = 12;
  if (ca > MAX_TERM || cb > MAX_TERM) {
    [ca, cb] = approximateRatio(ca, cb, MAX_TERM);
  }

  return { a: String(ca), b: String(cb) };
}

/** Convenience string form of {@link reducedOddsRatio}, e.g. `"3 : 1"`, or `""` when no ratio can be formed. */
export function oddsRatio(aTotal: number, bTotal: number): string {
  const parts = reducedOddsRatio(aTotal, bTotal);
  if (!parts.a || !parts.b) return '';
  return `${parts.a} : ${parts.b}`;
}

// ---------------------------------------------------------------------------
// Money / points formatting
// ---------------------------------------------------------------------------

/**
 * Formats a dollar amount for display. Whole-dollar stakes render without
 * cents (`"$40"`); anything with a fractional-cent value keeps exactly two
 * decimal places (`"$40.50"`) rather than always padding to `.00`.
 */
export function formatMoney(amount: number): string {
  const rounded = Math.round((amount || 0) * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded.toFixed(0)}` : `$${rounded.toFixed(2)}`;
}

/**
 * Plain-text form of a W (WagerPals play-currency) amount, e.g. `"W40"` /
 * `"W40.50"` — no space between the glyph letter and the digits. This is the
 * sibling of the visual mark rendered by components/WMark.tsx's `WMark` /
 * `WAmount`: use this helper anywhere a real DOM node can't carry the SVG
 * glyph — aria-labels, push notifications, activity feed strings, OG
 * content. See W-CURRENCY-SPEC.md.
 */
export function formatW(amount: number): string {
  const rounded = Math.round((amount || 0) * 100) / 100;
  return Number.isInteger(rounded) ? `W${rounded.toFixed(0)}` : `W${rounded.toFixed(2)}`;
}

/** Picks {@link formatMoney} or the plain-text {@link formatW} form for a stake amount, based on the event's payment type. */
export function formatStake(amount: number, paymentType: 'none' | 'cash' = 'cash'): string {
  return paymentType === 'cash' ? formatMoney(amount) : formatW(amount);
}

/**
 * Formats a 0-100 split value as e.g. `"67%"`. Rounds defensively in case a
 * caller passes a raw fraction/percent rather than one already produced by
 * {@link splitPercent}.
 */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}
