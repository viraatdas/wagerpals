// The big tabular odds display from the card sketch: "3 : 1" alongside
// "$40 staked". Plex Mono with tabular figures, emerald/crimson split
// across the two sides of the ratio (large numerals, so canonical crimson
// is fine here per the token contract — only SMALL crimson text needs the
// darker `crimson-ink` twin). The staked amount counts up on first mount.
//
// No local state of its own; CountUp underneath is the only client bit.

import { reducedOddsRatio, formatStake } from '@/lib/odds';
import CountUp, { CountUpFormatter } from './CountUp';

export type OddsLineSize = 'compact' | 'large';

export interface OddsLineProps {
  sideA: { label: string; total: number };
  sideB: { label: string; total: number };
  /** Total staked to show next to the ratio, e.g. the event's pot. */
  stakeAmount: number;
  paymentType?: 'none' | 'cash';
  size?: OddsLineSize;
  className?: string;
}

const SIZE_CLASSES: Record<OddsLineSize, { ratio: string; stake: string; gap: string }> = {
  compact: { ratio: 'text-2xl', stake: 'text-base', gap: 'gap-3' },
  large: { ratio: 'text-4xl', stake: 'text-xl', gap: 'gap-4' },
};

export default function OddsLine({
  sideA,
  sideB,
  stakeAmount,
  paymentType = 'cash',
  size = 'compact',
  className,
}: OddsLineProps) {
  const ratio = reducedOddsRatio(sideA.total, sideB.total);
  const classes = SIZE_CLASSES[size];
  const isEmpty = ratio.a === '—';
  // CountUp's own formatter only ever supplies ONE unit marker — for cash
  // that's the "$" prefix, so the trailing word can just say "staked". For
  // points there is no prefix glyph, so the plain number is paired with a
  // trailing "pts staked" instead of double-appending "pts" from both
  // CountUp and this label.
  const formatter: CountUpFormatter = paymentType === 'cash' ? 'currency' : 'plain';
  const stakeWord = paymentType === 'cash' ? 'staked' : 'pts staked';

  return (
    <div className={`flex items-baseline ${classes.gap} ${className ?? ''}`}>
      <span
        className={`font-mono font-medium tabular-nums ${classes.ratio}`}
        aria-label={`Odds ${sideA.label} to ${sideB.label}: ${ratio.a} to ${ratio.b}`}
      >
        <span className={isEmpty ? 'text-ink-muted' : 'text-emerald'}>{ratio.a}</span>
        <span className="px-1 text-ink-muted"> : </span>
        <span className={isEmpty ? 'text-ink-muted' : 'text-crimson'}>{ratio.b}</span>
      </span>

      <span className={`flex items-baseline gap-1.5 font-sans text-ink-secondary ${classes.stake}`}>
        <CountUp
          value={stakeAmount}
          formatter={formatter}
          ariaLabel={formatStake(stakeAmount, paymentType)}
        />
        <span>{stakeWord}</span>
      </span>
    </div>
  );
}
