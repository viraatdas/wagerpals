'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatTimeLeft } from '@/lib/utils';
import { EventWithStats } from '@/lib/types';

interface EventCardProps {
  event: Omit<EventWithStats, 'bets'>;
  isPublic?: boolean;
}

export default function EventCard({ event, isPublic = false }: EventCardProps) {
  const timeLeft = formatTimeLeft(event.end_time);
  const isEnded = event.end_time < Date.now();
  const isResolved = event.status === 'resolved';

  const statsA = event.side_stats[event.side_a] || { count: 0, total: 0 };
  const statsB = event.side_stats[event.side_b] || { count: 0, total: 0 };
  const pool = statsA.total + statsB.total;
  // Real odds split — defaults to 50/50 when no money is in yet.
  const pctA = pool > 0 ? Math.round((statsA.total / pool) * 100) : 50;
  const fmt = (n: number) => (isPublic ? `${n.toFixed(0)} pts` : `$${n.toFixed(2)}`);

  const winningSide = event.resolution?.winning_side;
  const aWins = isResolved && winningSide === event.side_a;
  const bWins = isResolved && winningSide === event.side_b;
  const leaderTone = isResolved ? (aWins ? 'tone-win' : bWins ? 'tone-win' : 'tone-neutral') : pctA >= 50 ? 'tone-yes' : 'tone-no';

  // Presentational-only: animate the split bar in from 50/50 on mount.
  const [displayPctA, setDisplayPctA] = useState(50);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDisplayPctA(pctA));
    return () => cancelAnimationFrame(raf);
  }, [pctA]);

  return (
    <Link href={`/events/${event.id}`} className="group block">
      <div className={`card card-interactive rail-top ${leaderTone} rounded-2xl p-5 relative overflow-hidden`}>
        {/* top row: status + people */}
        <div className="flex items-center justify-between gap-2 mb-3">
          {isResolved ? (
            <span className="pill tone-win">
              <span className="tone-dot" /> Resolved
            </span>
          ) : isEnded ? (
            <span className="pill tone-pending">
              <span className="tone-dot" /> Ended
            </span>
          ) : (
            <span className="pill tone-yes">
              <span className="tone-dot" /> Ends in {timeLeft}
            </span>
          )}
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="text-xs font-medium text-muted">
              {event.total_participants} {event.total_participants === 1 ? 'player' : 'players'}
            </span>
            {typeof event.comment_count === 'number' && event.comment_count > 0 && (
              <span className="text-xs font-medium text-muted">
                💬 {event.comment_count}
              </span>
            )}
          </div>
        </div>

        <h3 className="market-title text-lg break-words mb-1 group-hover:text-accent transition-colors">
          {event.title}
        </h3>

        {isResolved && event.resolution && (
          <p className="text-sm text-muted mb-3">
            Winner: <span className="font-semibold tone-text tone-win">{event.resolution.winning_side}</span>
          </p>
        )}

        {/* odds split bar — the signature market chrome */}
        <div className="mt-4 mb-3">
          <div className="odds-track">
            <div className="odds-fill odds-fill-yes" style={{ width: `${displayPctA}%` }} />
            <div className="odds-fill odds-fill-no" style={{ width: `${100 - displayPctA}%` }} />
          </div>
        </div>

        {/* Sides. One split panel divided down the middle — NOT two bordered
            boxes. A card inside a card is the template tell this design avoids;
            the tone fill alone carries which side is which. */}
        <div className="grid grid-cols-2 divide-x divide-hairline overflow-hidden rounded-xl">
          {[
            { side: event.side_a, stats: statsA, tone: 'tone-yes', pct: pctA, wins: aWins },
            { side: event.side_b, stats: statsB, tone: 'tone-no', pct: 100 - pctA, wins: bWins },
          ].map(({ side, stats, tone, pct, wins }) => (
            <div
              key={side}
              className={`tone-surface p-3 min-w-0 ${isResolved && !wins ? 'opacity-60' : ''} ${isResolved && wins ? 'tone-win' : tone}`}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-sm font-medium text-foreground break-words min-w-0 truncate">{side}</span>
                {isResolved && wins && <span className="tone-text text-xs font-bold shrink-0">WON</span>}
              </div>
              <div className="numeral tone-text text-2xl">{pct}%</div>
              <div className="text-xs text-muted font-medium mt-0.5">
                {stats.count} {stats.count === 1 ? 'bet' : 'bets'} · {fmt(stats.total)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}
