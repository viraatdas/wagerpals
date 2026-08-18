'use client';

// A number that animates from 0 up to its value on FIRST MOUNT ONLY (the
// "ticker" flourish described in the redesign spec). Re-renders with the
// same value never replay the count; a value that changes after mount just
// sets instantly unless the caller opts into `animateOnChange`.
//
// SSR-safe: the server (and the very first client render, before hydration
// effects run) both show the final formatted value, so there is no flash of
// "0" and nothing is left stuck at 0 if JS is slow or absent. The count-up
// only happens once the component has actually mounted on the client.

import { useEffect, useRef, useState } from 'react';

export type CountUpFormatter = 'currency' | 'points' | 'percent' | 'plain';

export interface CountUpProps {
  /** The value to land on. */
  value: number;
  /** How to render the number. Defaults to 'plain'. */
  formatter?: CountUpFormatter;
  /**
   * Decimal places to show. Defaults per formatter: currency 2, points 0,
   * percent 0, plain 0.
   */
  decimals?: number;
  /** Animation length in ms. Defaults to 600. */
  duration?: number;
  /**
   * Re-run the count-up animation when `value` changes after the first
   * mount. Defaults to false: a value that changes later (e.g. a live
   * total ticking up from a poll) just sets instantly instead of replaying
   * the ticker every time.
   */
  animateOnChange?: boolean;
  className?: string;
  /** Overrides the accessible label; defaults to the formatted final value. */
  ariaLabel?: string;
}

const DEFAULT_DECIMALS: Record<CountUpFormatter, number> = {
  currency: 2,
  points: 0,
  percent: 0,
  plain: 0,
};

function formatValue(value: number, formatter: CountUpFormatter, decimals: number): string {
  const fixed = value.toFixed(decimals);
  switch (formatter) {
    case 'currency':
      return `$${fixed}`;
    case 'points':
      return `${fixed} pts`;
    case 'percent':
      return `${fixed}%`;
    case 'plain':
    default:
      return fixed;
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export default function CountUp({
  value,
  formatter = 'plain',
  decimals,
  duration = 600,
  animateOnChange = false,
  className,
  ariaLabel,
}: CountUpProps) {
  const resolvedDecimals = decimals ?? DEFAULT_DECIMALS[formatter];

  // Server render and the first client render both show the final value.
  const [display, setDisplay] = useState(value);
  const mountedRef = useRef(false);
  const displayRef = useRef(value);
  displayRef.current = display;
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const isFirstRun = !mountedRef.current;
    mountedRef.current = true;

    if (!isFirstRun && !animateOnChange) {
      setDisplay(value);
      return;
    }

    if (prefersReducedMotion() || duration <= 0) {
      setDisplay(value);
      return;
    }

    const start = isFirstRun ? 0 : displayRef.current;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Exponential ease-out, matching the confidence bar's easing feel.
      const eased = progress >= 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplay(start + (value - start) * eased);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
    // Deliberately only keyed on `value`/`animateOnChange` — this is a
    // "first mount, then explicit opt-in" ticker, not a generic effect that
    // should re-subscribe on every render (duration/formatter changing
    // mid-flight is not a supported case).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, animateOnChange]);

  const finalFormatted = formatValue(value, formatter, resolvedDecimals);
  const displayFormatted = formatValue(display, formatter, resolvedDecimals);

  return (
    <span className={className}>
      <span aria-hidden="true" className="font-mono tabular-nums">
        {displayFormatted}
      </span>
      <span className="sr-only">{ariaLabel ?? finalFormatted}</span>
    </span>
  );
}
