import Link from 'next/link';
import { Bet, EventWithStats } from '@/lib/types';
import AvatarStack, { AvatarPerson } from './AvatarStack';
import ConfidenceBar from './ConfidenceBar';
import OddsLine from './OddsLine';
import StatusPill, { StatusPillStatus } from './StatusPill';
import CountUp from './CountUp';

// The wager card — the design thesis in miniature. Top half (avatars, title,
// status; the odds ratio; the confidence bar) is sportsbook-crisp. Bottom
// half (the human row) is friend-loose. See DESIGN-SPEC.md "Layout — The
// Board" for the card sketch this mirrors row for row.
//
// Bettor identities and the latest quote come from two sources, preferred in
// this order:
//   1. `event.bettor_preview` / `event.latest_comment` — batched, additive
//      fields db.events.getAllWithStats now populates on the LIST payload
//      (Board / Live / group pages). See lib/db.ts and lib/types.ts.
//   2. `event.bets` — present on detail-view payloads (and any other caller
//      that already has full bet rows), used the same way it always was.
// Every per-bettor-identity feature below (row-1 avatars, per-side
// confidence-bar avatars, the human row's avatar cluster, the latest-note
// quote) degrades gracefully to count-only / hidden when NEITHER source is
// present.

interface EventCardProps {
  event: Omit<EventWithStats, 'bets'> & { bets?: Bet[] };
  /** Which group this wager belongs to — shown as a small muted tag when the
      surrounding list mixes groups (the Board's "All" view). Plain text, not
      a link: the whole card is already wrapped in a Link to the event. */
  groupName?: string;
  className?: string;
}

/** Unique bettors, most recently active first. */
function participantsFromBets(bets: Bet[] | undefined): AvatarPerson[] {
  if (!bets || bets.length === 0) return [];
  const sorted = [...bets].sort((a, b) => b.timestamp - a.timestamp);
  const seen = new Map<string, AvatarPerson>();
  for (const bet of sorted) {
    if (!seen.has(bet.user_id)) {
      seen.set(bet.user_id, { username: bet.username });
    }
  }
  return Array.from(seen.values());
}

/** Unique bettors backing one specific side, most recently active first. */
function sideParticipants(bets: Bet[] | undefined, side: string): AvatarPerson[] {
  return participantsFromBets(bets?.filter((b) => b.side === side));
}

/** bettor_preview entries as AvatarPerson, already ordered most-recent-first by the query. */
function participantsFromPreview(preview: EventWithStats['bettor_preview']): AvatarPerson[] {
  if (!preview || preview.length === 0) return [];
  return preview.map((p) => ({ username: p.username, avatar_url: p.avatar_url }));
}

/** bettor_preview entries backing one specific side. */
function sidePreviewParticipants(preview: EventWithStats['bettor_preview'], side: string): AvatarPerson[] {
  return participantsFromPreview(preview?.filter((p) => p.side === side));
}

// A bet's own optional `note` is trash talk attached directly to a wager
// (Ledger.tsx already quotes it the same way) — used as the quote-row
// fallback when `event.latest_comment` isn't present on the payload.
function latestNote(bets: Bet[] | undefined): { username: string; note: string } | null {
  if (!bets) return null;
  let best: Bet | null = null;
  for (const bet of bets) {
    if (!bet.note || !bet.note.trim()) continue;
    if (!best || bet.timestamp > best.timestamp) best = bet;
  }
  return best ? { username: best.username, note: best.note!.trim() } : null;
}

// Events never expire (R2) — status is 'active' | 'resolved' only, and
// end_time is meaningless. active -> live, resolved -> settled.
function statusFor(event: EventCardProps['event']): StatusPillStatus {
  return event.status === 'resolved' ? 'settled' : 'live';
}

export default function EventCard({ event, groupName, className }: EventCardProps) {
  const statsA = event.side_stats[event.side_a] || { count: 0, total: 0 };
  const statsB = event.side_stats[event.side_b] || { count: 0, total: 0 };
  const pool = statsA.total + statsB.total;
  const paymentType = event.payment_type ?? 'cash';

  const isResolved = event.status === 'resolved';
  const winningSide = event.resolution?.winning_side;
  // Winner always occupies the "sideA" slot the primitives paint emerald, so
  // a settled card reads emerald = won / crimson = lost regardless of which
  // side happened to be side_a/side_b while the wager was open.
  const bWon = isResolved && winningSide === event.side_b;
  const leftLabel = bWon ? event.side_b : event.side_a;
  const leftStats = bWon ? statsB : statsA;
  const rightLabel = bWon ? event.side_a : event.side_b;
  const rightStats = bWon ? statsA : statsB;

  const hasPreview = !!event.bettor_preview && event.bettor_preview.length > 0;
  const leftAvatars = hasPreview
    ? sidePreviewParticipants(event.bettor_preview, leftLabel)
    : sideParticipants(event.bets, leftLabel);
  const rightAvatars = hasPreview
    ? sidePreviewParticipants(event.bettor_preview, rightLabel)
    : sideParticipants(event.bets, rightLabel);
  const participants = hasPreview
    ? participantsFromPreview(event.bettor_preview)
    : participantsFromBets(event.bets);
  const quote = event.latest_comment
    ? { username: event.latest_comment.username, note: event.latest_comment.content }
    : latestNote(event.bets);
  const betWord = event.total_bets === 1 ? 'bet' : 'bets';

  return (
    <Link href={`/events/${event.id}`} className="block">
      <div
        className={`rounded-card border border-line bg-card p-5 shadow-elev-1 transition-all duration-base ease-out-expo hover:-translate-y-0.5 hover:shadow-elev-2 ${className ?? ''}`}
      >
        {/* Row 1 — who's playing, what it's called, what state it's in */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {participants.length > 0 ? (
              <AvatarStack people={participants} size="sm" max={4} className="shrink-0" />
            ) : event.total_bets > 0 ? (
              <span
                aria-label={`${event.total_bets} ${betWord}`}
                className="inline-flex h-6 shrink-0 items-center justify-center rounded-pill border-2 border-amber bg-amber/15 px-2 font-mono text-xs font-medium text-amber-ink"
              >
                {event.total_bets}
              </span>
            ) : null}
            <div className="min-w-0">
              {groupName && (
                <div className="truncate font-sans text-xs text-ink-muted">{groupName}</div>
              )}
              <h3 className="min-w-0 line-clamp-2 break-words font-sans text-base font-medium text-ink">
                {event.title}
              </h3>
            </div>
          </div>
          <StatusPill status={statusFor(event)} className="shrink-0" />
        </div>

        {/* Row 2 — the odds, sportsbook-crisp */}
        <OddsLine
          className="mt-4"
          size="compact"
          sideA={{ label: leftLabel, total: leftStats.total }}
          sideB={{ label: rightLabel, total: rightStats.total }}
          stakeAmount={pool}
          paymentType={paymentType}
        />

        {/* Row 3 — the confidence bar, the signature element */}
        <ConfidenceBar
          className="mt-4"
          size="compact"
          sideA={{
            label: leftLabel,
            total: leftStats.total,
            avatars: leftAvatars.length > 0 ? leftAvatars : undefined,
          }}
          sideB={{
            label: rightLabel,
            total: rightStats.total,
            avatars: rightAvatars.length > 0 ? rightAvatars : undefined,
          }}
        />

        {/* Divider, then the human row — friend-loose */}
        <div className="mt-4 border-t border-line pt-3">
          {quote ? (
            <p className="truncate font-sans text-sm text-ink-muted">
              <span className="text-ink-secondary">&ldquo;{quote.note}&rdquo;</span> &middot; {quote.username}
            </p>
          ) : event.total_bets > 0 ? (
            <div className="flex items-center gap-2">
              {participants.length > 0 && (
                <AvatarStack people={participants} size="sm" max={4} />
              )}
              <span className="font-sans text-sm text-ink-muted">
                <CountUp value={event.total_bets} formatter="plain" /> {betWord}
              </span>
            </div>
          ) : (
            <p className="font-sans text-sm text-ink-muted">No bets yet</p>
          )}
        </div>
      </div>
    </Link>
  );
}
