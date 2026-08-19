// The W — WagerPals' play-currency glyph: a "W" with a single thin vertical
// stroke through its center. There's no unicode equivalent, so it's drawn
// here as an inline SVG that sits inline with text, inherits color via
// currentColor (never amber — the mark IS money), and scales with
// font-size like a character would. See W-CURRENCY-SPEC.md "The glyph".
//
// `formatW` (lib/odds.ts) is the plain-text sibling of this component — use
// that anywhere a real DOM node can't render the mark (aria-labels, push
// notifications, activity strings, og content).

import { formatW } from '@/lib/odds';
import CountUp from './CountUp';

export interface WMarkProps {
  className?: string;
}

/**
 * The bare glyph, decorative by default (the caller is expected to supply
 * the accessible label — see WAmount below). viewBox is 100x100: the W
 * zigzag runs from y=22 (its two peaks) to y=78 (its two valleys), and the
 * center stroke is 8 units wide (8% of the glyph), extending from y=14 to
 * y=86 — ~15% of the W's own 56-unit height beyond its top and bottom.
 */
export function WMark({ className }: WMarkProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      // Deliberately SMALLER than the digits (0.68em), and BOTTOM-ALIGNED:
      // in the parent's items-baseline flex row an SVG's baseline is its
      // bottom edge, so with no self-alignment override the mark sits on the
      // same line the digits sit on — a compact ticker-style prefix, never a
      // letter-sized glyph floating mid-height. (Owner: "smaller, inline,
      // lined with the bottom.")
      className={`inline-block h-[0.68em] w-[0.68em] shrink-0 ${className ?? ''}`}
    >
      <path
        d="M8 22 L28 78 L50 40 L72 78 L92 22"
        fill="none"
        stroke="currentColor"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="46" y="14" width="8" height="72" fill="currentColor" />
    </svg>
  );
}

export interface WAmountProps {
  value: number;
  className?: string;
  /** Classes applied to just the glyph (e.g. sizing it apart from the digits). */
  markClassName?: string;
  /**
   * Animates the digits up from 0 on first mount, matching the treatment
   * $ balances already get elsewhere (see WalletPanel). Defaults to false —
   * most inline stake amounts (a bet row, an odds line) land instantly;
   * this is for hero-sized balance numbers.
   */
  animate?: boolean;
}

/** The mark plus mono digits, e.g. glyph + "40" for a W40 stake. */
export default function WAmount({ value, className, markClassName, animate = false }: WAmountProps) {
  const rounded = Math.round((value || 0) * 100) / 100;
  const digits = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2);

  return (
    <span
      className={`inline-flex items-baseline gap-0.5 font-mono tabular-nums ${className ?? ''}`}
      aria-label={animate ? undefined : formatW(value)}
    >
      <WMark className={markClassName} />
      {animate ? (
        <CountUp value={value} formatter="plain" ariaLabel={formatW(value)} />
      ) : (
        <span aria-hidden="true">{digits}</span>
      )}
    </span>
  );
}
