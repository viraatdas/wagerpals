// LIVE / OPEN / SETTLED / ENDED — the state-of-the-wager label. Per the
// shape language, pills are reserved for labels ABOUT people or state (never
// primary actions), so this is fully rounded. Per the motion rules, nothing
// beyond the confidence bar fill and the count-up may animate, so LIVE reads
// as "live" through colour and weight alone, not a blinking dot.
//
// No 'use client' needed: purely presentational, no state or effects.

export type StatusPillStatus = 'live' | 'open' | 'settled' | 'ended' | 'cancelled' | 'pending';

export interface StatusPillProps {
  status: StatusPillStatus;
  /** Overrides the displayed text; defaults to the status name, upper-cased. */
  label?: string;
  className?: string;
}

/**
 * Colour mapping decision (spec leaves this open beyond "LIVE should read as
 * genuinely live"): a status pill describes the wager's state, not a number
 * or a person, so amber is off the table (people-only) and emerald/crimson
 * are reserved for win/loss framing that a pill covering *every* bettor
 * shouldn't imply on its own.
 *
 * - live: solid emerald fill + bold weight — unmistakably "happening now."
 * - settled: emerald tint outline — the question got a real resolution.
 * - open / pending: neutral outline — still waiting on outcome or action.
 * - ended: muted neutral — time ran out, independent of who won.
 * - cancelled: crimson tint outline — the wager was stopped.
 */
const VARIANTS: Record<StatusPillStatus, { classes: string; label: string }> = {
  live: {
    classes: 'bg-emerald text-on-emerald font-medium',
    label: 'Live',
  },
  open: {
    classes: 'bg-card text-ink-secondary border border-line font-medium',
    label: 'Open',
  },
  settled: {
    classes: 'bg-emerald/10 text-emerald border border-emerald/30 font-medium',
    label: 'Settled',
  },
  ended: {
    classes: 'bg-line/50 text-ink-muted font-medium',
    label: 'Ended',
  },
  cancelled: {
    classes: 'bg-crimson/10 text-crimson-ink border border-crimson/30 font-medium',
    label: 'Cancelled',
  },
  pending: {
    classes: 'bg-card text-ink-secondary border border-line border-dashed font-medium',
    label: 'Pending',
  },
};

export default function StatusPill({ status, label, className }: StatusPillProps) {
  const variant = VARIANTS[status];
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2.5 py-0.5 font-mono text-xs uppercase tracking-wide ${variant.classes} ${className ?? ''}`}
    >
      {label ?? variant.label}
    </span>
  );
}
