'use client';

// THE signature element of the redesign — per the spec, this is what makes a
// cropped screenshot recognizable as WagerPals, so it must render
// identically everywhere a wager appears (board, detail view, activity
// feed, notifications).
//
// SSR/no-JS behaviour: the server (and the very first client render, before
// hydration effects run) render the bar already AT its resting split — a
// visitor with slow or no JS sees the correct lean immediately, never an
// empty bar stuck at 0. Once mounted, an effect deliberately resets BOTH
// fills to 0 and animates each back up to its own resting width over
// ~400ms ease-out — the "ticker flourish" — but only on first mount, never
// on re-render. If the underlying totals change later (a new bet shifts
// the lean), the bar transitions to the new split too, using the same
// easing, as ordinary reactivity rather than a replay of the entrance
// animation.
//
// The two fills are NOT flex siblings (that would make resetting side A to
// 0 implicitly blow side B out to 100, flashing the track fully crimson
// before emerald wipes across it). Instead the track is `relative` and both
// fills are absolutely positioned — emerald anchored `left-0`, crimson
// anchored `right-0` — each independently animating its own width from 0%
// to its resting pct. At rest the two pcts sum to exactly 100 (see
// lib/odds.ts splitPercent), so they meet cleanly at the split; mid-flourish
// they grow from opposite edges toward the middle instead of one wiping
// over the other.

import { useEffect, useRef, useState } from 'react';
import { splitPercent, formatPercent } from '@/lib/odds';
import AvatarStack, { AvatarPerson, AvatarStackSize } from './AvatarStack';

export type ConfidenceBarSize = 'compact' | 'large';

export interface ConfidenceBarSide {
  /** Side name, e.g. event.side_a / event.side_b. */
  label: string;
  /** Pool total staked on this side. */
  total: number;
  /** People backing this side, clustered under the bar where their bet lands. */
  avatars?: AvatarPerson[];
}

export interface ConfidenceBarProps {
  sideA: ConfidenceBarSide;
  sideB: ConfidenceBarSide;
  size?: ConfidenceBarSize;
  className?: string;
}

const SIZE_CONFIG: Record<
  ConfidenceBarSize,
  { track: string; labelText: string; avatarSize: AvatarStackSize; avatarMax: number }
> = {
  compact: { track: 'h-2', labelText: 'text-xs', avatarSize: 'sm', avatarMax: 3 },
  large: { track: 'h-3', labelText: 'text-sm', avatarSize: 'md', avatarMax: 5 },
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export default function ConfidenceBar({ sideA, sideB, size = 'compact', className }: ConfidenceBarProps) {
  const config = SIZE_CONFIG[size];
  const restingSplit = splitPercent(sideA.total, sideB.total);

  // Zero-pool decision comes straight from the props' totals, never from
  // the animated fill state — a wager with nothing staked on either side
  // must never paint a fake 50/50 split just because splitPercent() rests
  // there when the pool is empty.
  const isEmpty = Math.max(0, sideA.total || 0) + Math.max(0, sideB.total || 0) <= 0;

  // Mirrors the latest resting split (and empty-ness) into refs so the
  // mount-only effect below can read fresh values without needing them as
  // dependencies.
  const restingSplitRef = useRef(restingSplit);
  restingSplitRef.current = restingSplit;
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;

  // Both fills match the resting split on the server render and the first
  // client render — no flash of empty, no hydration mismatch.
  const [fillPctA, setFillPctA] = useState(restingSplit.pctA);
  const [fillPctB, setFillPctB] = useState(restingSplit.pctB);
  const [transitioning, setTransitioning] = useState(false);
  const hasMountedRef = useRef(false);

  // Mount-only flourish: both fills 0 -> their own resting width, once.
  // Skipped entirely for an empty pool — there is no fill to animate in,
  // and animating a hidden track would be motion with nothing to show for
  // it.
  useEffect(() => {
    if (isEmptyRef.current || prefersReducedMotion()) {
      hasMountedRef.current = true;
      return;
    }

    setTransitioning(false);
    setFillPctA(0);
    setFillPctB(0);

    let raf2: number | undefined;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setTransitioning(true);
        setFillPctA(restingSplitRef.current.pctA);
        setFillPctB(restingSplitRef.current.pctB);
        hasMountedRef.current = true;
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== undefined) cancelAnimationFrame(raf2);
    };
    // Intentionally empty deps: this flourish runs once on mount only, never
    // on re-render, per the redesign spec.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ordinary reactivity: if the pool shifts after mount (a new bet lands),
  // ease both fills to their new widths instead of leaving them stale.
  // Guarded so it never fires before the mount effect has taken over.
  useEffect(() => {
    if (!hasMountedRef.current) return;
    setTransitioning(true);
    setFillPctA(restingSplit.pctA);
    setFillPctB(restingSplit.pctB);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restingSplit.pctA, restingSplit.pctB]);

  const transitionClass = transitioning ? 'transition-[width] duration-bar ease-out-expo' : '';
  const accessibleLabel = isEmpty
    ? `${sideA.label} vs ${sideB.label}, no stakes yet`
    : `${sideA.label} ${formatPercent(restingSplit.pctA)}, ${sideB.label} ${formatPercent(restingSplit.pctB)}`;

  const hasAvatars = (sideA.avatars && sideA.avatars.length > 0) || (sideB.avatars && sideB.avatars.length > 0);

  return (
    <div className={className}>
      <div className={`mb-1 flex items-center font-mono ${config.labelText} ${isEmpty ? '' : 'justify-between'}`}>
        {isEmpty ? (
          <span className="text-ink-muted">no stakes yet</span>
        ) : (
          <>
            <span className="text-emerald">{formatPercent(restingSplit.pctA)}</span>
            <span className="text-crimson-ink">{formatPercent(restingSplit.pctB)}</span>
          </>
        )}
      </div>

      <div
        role="img"
        aria-label={accessibleLabel}
        className={`relative w-full overflow-hidden rounded-chip bg-line ${config.track}`}
      >
        {!isEmpty && (
          <>
            <div
              aria-hidden="true"
              className={`absolute left-0 top-0 h-full bg-emerald ${transitionClass}`}
              style={{ width: `${fillPctA}%` }}
            />
            <div
              aria-hidden="true"
              className={`absolute right-0 top-0 h-full bg-crimson ${transitionClass}`}
              style={{ width: `${fillPctB}%` }}
            />
          </>
        )}
      </div>

      {hasAvatars && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {sideA.avatars && sideA.avatars.length > 0 && (
              <AvatarStack people={sideA.avatars} size={config.avatarSize} max={config.avatarMax} />
            )}
            <span className="truncate font-sans text-xs text-ink-muted">backing {sideA.label}</span>
          </div>
          <div className="flex min-w-0 items-center justify-end gap-1.5">
            <span className="truncate text-right font-sans text-xs text-ink-muted">backing {sideB.label}</span>
            {sideB.avatars && sideB.avatars.length > 0 && (
              <AvatarStack people={sideB.avatars} size={config.avatarSize} max={config.avatarMax} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
