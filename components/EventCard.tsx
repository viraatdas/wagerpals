'use client';

import Link from 'next/link';
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
  // Visual odds split — defaults to 50/50 when no money is in yet.
  const pctA = pool > 0 ? Math.round((statsA.total / pool) * 100) : 50;
  const fmt = (n: number) => (isPublic ? `${n.toFixed(0)} pts` : `$${n.toFixed(2)}`);

  return (
    <Link href={`/events/${event.id}`} className="group block">
      <div className="glass glass-hover rounded-2xl p-5 relative overflow-hidden">
        {/* top row: status + people */}
        <div className="flex items-center justify-between mb-3">
          {isResolved ? (
            <span className="chip chip-yes">✓ Resolved</span>
          ) : isEnded ? (
            <span className="chip">⏳ Ended</span>
          ) : (
            <span className="chip chip-live">
              <span className="live-dot" /> Ends in {timeLeft}
            </span>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted">
              👥 {event.total_participants} {event.total_participants === 1 ? 'player' : 'players'}
            </span>
            {typeof event.comment_count === 'number' && event.comment_count > 0 && (
              <span className="text-xs font-medium text-muted">💬 {event.comment_count}</span>
            )}
          </div>
        </div>

        <h3 className="font-display text-lg font-semibold text-foreground leading-snug break-words mb-1 group-hover:text-brand-2 transition-colors">
          {event.title}
        </h3>

        {isResolved && event.resolution && (
          <p className="text-sm text-muted mb-3">
            Winner:{' '}
            <span className="font-semibold text-green-700">{event.resolution.winning_side}</span>
          </p>
        )}

        {/* odds split bar */}
        <div className="mt-4 mb-3">
          <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-gray-100">
            <div
              className="h-full bg-green-600 transition-[width] duration-500"
              style={{ width: `${pctA}%` }}
            />
            <div
              className="h-full bg-red-600 transition-[width] duration-500"
              style={{ width: `${100 - pctA}%` }}
            />
          </div>
        </div>

        {/* sides */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { side: event.side_a, stats: statsA, tone: 'mint' as const, pct: pctA },
            { side: event.side_b, stats: statsB, tone: 'rose' as const, pct: 100 - pctA },
          ].map(({ side, stats, tone, pct }) => (
            <div
              key={side}
              className={`rounded-xl p-3 min-w-0 border ${
                tone === 'mint'
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-sm font-medium text-foreground break-words min-w-0">{side}</span>
                <span
                  className={`text-sm font-bold tabular-nums ${
                    tone === 'mint' ? 'text-green-700' : 'text-red-700'
                  }`}
                >
                  {pct}%
                </span>
              </div>
              <div className="text-xs text-muted font-medium">
                {stats.count} {stats.count === 1 ? 'bet' : 'bets'} · {fmt(stats.total)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}
