'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@stackframe/stack';
import BetForm from '@/components/BetForm';
import Ledger from '@/components/Ledger';
import CommentThread from '@/components/CommentThread';
import ResolutionBanner from '@/components/ResolutionBanner';
import ConfirmationModal from '@/components/ConfirmationModal';
import Toast, { ToastType } from '@/components/Toast';
import StatusPill from '@/components/StatusPill';
import OddsLine from '@/components/OddsLine';
import ConfidenceBar from '@/components/ConfidenceBar';
import CountUp from '@/components/CountUp';
import WAmount, { WMark } from '@/components/WMark';
import { AvatarPerson } from '@/components/AvatarStack';
import { splitPercent } from '@/lib/odds';
import { EscrowHoldStatus, EventWithStats, NetResult } from '@/lib/types';
import { calculateNetResults, handle } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type EventPageData = EventWithStats & {
  is_public?: boolean;
  payment_type?: 'none' | 'cash';
  stake_amount?: number | null;
  escrow_total?: number;
  /** Escrow status of every bet in the event, keyed by bet id (cash events only). */
  escrow_by_bet?: Record<string, EscrowHoldStatus>;
};

type ConfirmationModalConfig = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  loadingText: string;
  type: 'danger' | 'warning' | 'success';
  onConfirm: () => void;
};

/** Unique bettors on one side, in first-appearance order, for the ConfidenceBar's avatar clusters. */
function sideAvatars(bets: EventWithStats['bets'], side: string): AvatarPerson[] {
  const seen = new Set<string>();
  const people: AvatarPerson[] = [];
  for (const bet of bets) {
    if (bet.side !== side || seen.has(bet.user_id)) continue;
    seen.add(bet.user_id);
    people.push({ username: bet.username });
  }
  return people;
}

export default function EventPage() {
  const params = useParams();
  const router = useRouter();
  const user = useUser({ or: "return-null" });
  const [event, setEvent] = useState<EventPageData | null>(null);
  const [commentCount, setCommentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [netResults, setNetResults] = useState<NetResult[]>([]);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [confirmationModal, setConfirmationModal] = useState<ConfirmationModalConfig>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    loadingText: '',
    type: 'danger',
    onConfirm: () => {},
  });

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
      return;
    }
    fetchEvent();
  }, [params.id, user, router]);

  const fetchEvent = async () => {
    if (!params.id) {
      setLoading(false);
      return;
    }

    try {
      const eventResponse = await fetch(`/api/events?id=${params.id}`);

      if (!eventResponse.ok) {
        throw new Error(`Failed to fetch event: ${eventResponse.status}`);
      }
      const data = await eventResponse.json();

      if (data.error) {
        console.error('Event not found:', data.error);
        setLoading(false);
        return;
      }

      setEvent(data);

      if (data.status === 'resolved' && data.resolution) {
        const results = calculateNetResults(data.bets, data.resolution.winning_side);
        setNetResults(results);
      } else {
        setNetResults([]);
      }
    } catch (error) {
      console.error('Failed to fetch event:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async (winningSide: string) => {
    if (!event || !user) return;

    setConfirmationModal({
      isOpen: true,
      title: 'Resolve event',
      message: `Resolve this as "${winningSide}"? This settles every bet in the market.`,
      confirmText: 'Resolve',
      loadingText: 'Resolving…',
      type: 'success',
      onConfirm: () => confirmResolve(winningSide),
    });
  };

  const confirmResolve = async (winningSide: string) => {
    if (!user) return;

    setConfirmationModal(prev => ({ ...prev, isOpen: false }));
    setResolving(true);

    try {
      const response = await fetch('/api/events/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: event!.id,
          winning_side: winningSide,
          resolved_by: user.id,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setToast({ message: data.error || "Couldn't resolve the event. Try again.", type: 'error' });
        return;
      }

      setToast({ message: 'Event resolved', type: 'success' });
      fetchEvent();
    } catch (error) {
      console.error('Failed to resolve event:', error);
      setToast({ message: "Couldn't resolve the event. Try again.", type: 'error' });
    } finally {
      setResolving(false);
    }
  };

  const handleUnresolve = async () => {
    if (!event || !user) return;

    setConfirmationModal({
      isOpen: true,
      title: 'Unresolve event',
      message: 'Unresolve this event? This reverses every payout.',
      confirmText: 'Unresolve',
      loadingText: 'Unresolving…',
      type: 'warning',
      onConfirm: confirmUnresolve,
    });
  };

  const confirmUnresolve = async () => {
    setConfirmationModal(prev => ({ ...prev, isOpen: false }));
    setResolving(true);

    try {
      const response = await fetch('/api/events/unresolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: event!.id,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setToast({ message: data.error || "Couldn't unresolve the event. Try again.", type: 'error' });
        return;
      }

      setToast({ message: 'Event unresolved', type: 'success' });
      fetchEvent();
    } catch (error) {
      console.error('Failed to unresolve event:', error);
      setToast({ message: "Couldn't unresolve the event. Try again.", type: 'error' });
    } finally {
      setResolving(false);
    }
  };

  const handleCancel = async () => {
    if (!event || !user) return;

    setConfirmationModal({
      isOpen: true,
      title: 'Cancel event',
      message: 'This refunds every escrowed stake to the bettors who placed them. The event cannot be un-cancelled.',
      confirmText: 'Cancel & Refund',
      loadingText: 'Cancelling…',
      type: 'warning',
      onConfirm: confirmCancel,
    });
  };

  const confirmCancel = async () => {
    if (!user) return;

    setConfirmationModal(prev => ({ ...prev, isOpen: false }));
    setResolving(true);

    try {
      const response = await fetch('/api/events/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: event!.id,
          action: 'cancel',
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setToast({ message: data.error || "Couldn't cancel the event. Try again.", type: 'error' });
        return;
      }

      setToast({ message: 'Event cancelled and stakes refunded', type: 'success' });
      fetchEvent();
    } catch (error) {
      console.error('Failed to cancel event:', error);
      setToast({ message: "Couldn't cancel the event. Try again.", type: 'error' });
    } finally {
      setResolving(false);
    }
  };

  const handleDelete = async () => {
    if (!event) return;

    setConfirmationModal({
      isOpen: true,
      title: 'Delete event',
      message: `Delete "${event.title}"? This removes every bet on it, permanently.`,
      confirmText: 'Delete',
      loadingText: 'Deleting…',
      type: 'danger',
      onConfirm: confirmDelete,
    });
  };

  const confirmDelete = async () => {
    setConfirmationModal(prev => ({ ...prev, isOpen: false }));
    setDeleting(true);

    try {
      const response = await fetch('/api/events/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: event!.id,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setToast({ message: data.error || "Couldn't delete the event. Try again.", type: 'error' });
        return;
      }

      router.push('/');
    } catch (error) {
      console.error('Failed to delete event:', error);
      setToast({ message: "Couldn't delete the event. Try again.", type: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  // Presentational-only: the odds split, derived from data already in scope.
  const sideAStats = event ? event.side_stats[event.side_a] : undefined;
  const sideBStats = event ? event.side_stats[event.side_b] : undefined;
  const poolTotal = (sideAStats?.total ?? 0) + (sideBStats?.total ?? 0);
  const { pctA, pctB } = splitPercent(sideAStats?.total ?? 0, sideBStats?.total ?? 0);

  const sideAAvatars = useMemo(
    () => (event ? sideAvatars(event.bets, event.side_a) : []),
    [event]
  );
  const sideBAvatars = useMemo(
    () => (event ? sideAvatars(event.bets, event.side_b) : []),
    [event]
  );

  if (!user) {
    return null; // Will redirect to signin
  }

  if (loading) {
    return (
      <div className="page-shell mobile-page">
        <div className="card-focal p-5 sm:p-8 mb-6">
          <div className="flex items-center justify-between mb-5 gap-3">
            <div className="skeleton-line h-3 w-28" />
            <div className="skeleton-line h-6 w-16 rounded-full" />
          </div>
          <div className="skeleton-line h-8 w-full max-w-lg mb-2" />
          <div className="skeleton-line h-8 w-2/3 mb-6" />
          <div className="flex gap-2 mb-6">
            <div className="skeleton-line h-5 w-24 rounded-full" />
            <div className="skeleton-line h-5 w-20 rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="skeleton-line h-8 w-16" />
            <div className="skeleton-line h-8 w-16 ml-auto" />
          </div>
          <div className="skeleton h-2.5 w-full rounded-full mb-6" />
          <div className="grid grid-cols-3 gap-4 pt-5 border-t border-[var(--color-border)]">
            <div className="skeleton-line h-6 w-14" />
            <div className="skeleton-line h-6 w-14" />
            <div className="skeleton-line h-6 w-14" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6">
          <div className="skeleton h-28 rounded-2xl" />
          <div className="skeleton h-28 rounded-2xl" />
        </div>
        <div className="skeleton h-32 rounded-2xl mb-8" />
        <div className="space-y-2">
          <div className="skeleton-line h-10 w-full rounded-lg" />
          <div className="skeleton-line h-10 w-full rounded-lg" />
          <div className="skeleton-line h-10 w-3/4 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="page-shell-narrow mobile-page">
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </div>
          <p className="empty-state-title">Event not found</p>
          <p className="empty-state-body">This market is gone, or the link&apos;s wrong.</p>
          <Link href="/" className="btn-primary mt-2">
            Back to events
          </Link>
        </div>
      </div>
    );
  }

  // R2: creator-only resolve/unresolve/cancel/delete. event.created_by
  // already carries the server's group-creator fallback for legacy rows
  // with no created_by of their own (see app/api/events/route.ts) — the
  // server enforces this the same way (403 otherwise), this is purely UI.
  const isCreator = !!event.created_by && event.created_by === user.id;
  const canResolve = event.status === 'active' && isCreator;
  const username = user.displayName || user.primaryEmail || 'User';
  const isCash = event.payment_type === 'cash';
  const isCancelled = event.status === 'resolved' && !event.resolution;

  return (
    <>
      <ConfirmationModal
        isOpen={confirmationModal.isOpen}
        onClose={() => setConfirmationModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmationModal.onConfirm}
        title={confirmationModal.title}
        message={confirmationModal.message}
        confirmText={confirmationModal.confirmText}
        loadingText={confirmationModal.loadingText}
        type={confirmationModal.type}
        loading={deleting || resolving}
      />
      <Toast
        isOpen={toast !== null}
        onClose={() => setToast(null)}
        message={toast?.message || ''}
        type={toast?.type || 'info'}
      />

      <div className="page-shell mobile-page animate-rise">
        {/* Market header — the page's one focal point */}
        <div className="card-focal p-5 sm:p-8 mb-6">
          <div className="flex items-start justify-between gap-3 mb-5">
            <Link
              href={`/groups/${event.group_id}`}
              className="eyebrow tone-text press inline-flex items-center gap-1 hover:opacity-75"
            >
              <span aria-hidden="true">&larr;</span> Back to group
            </Link>
            {isCreator && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="btn-quiet-danger press shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>

          <h1 className="market-title text-2xl sm:text-3xl md:text-4xl mb-4 break-words">
            {event.title}
          </h1>

          <div className="flex flex-wrap items-center gap-2 mb-6">
            {isCancelled ? (
              <StatusPill status="cancelled" />
            ) : event.status === 'resolved' ? (
              <StatusPill status="settled" />
            ) : (
              <StatusPill status="live" />
            )}

            {isCash && <span className="tone-info pill">Real money</span>}

            {isCash && (
              typeof event.stake_amount === 'number' && event.stake_amount > 0 ? (
                <span className="tone-neutral pill font-mono">Stake ${event.stake_amount.toFixed(2)}</span>
              ) : (
                <span className="tone-neutral pill">Open stakes</span>
              )
            )}
          </div>

          {/* R2/R3: no admin/resolver role — the event's own creator is the
              only one who can settle it. Quiet, always-visible context near
              the resolve area (see the "Resolve market" section below). */}
          {event.creator_username && (
            <p className="field-hint mb-6">
              Started by <span className="font-medium text-ink">{handle(event.creator_username)}</span>. Only they can settle it.
            </p>
          )}

          {isCash && (event.escrow_total ?? 0) > 0 && (
            <p className="field-hint mb-6">
              <span className="tone-pending tone-text font-medium font-mono">
                ${(event.escrow_total ?? 0).toFixed(2)}
              </span>{' '}
              held in escrow across all bettors.
            </p>
          )}

          {/* Signature element, full size: mono ratio + staked total, then the
              confidence split with per-side avatar clusters where the money is. */}
          <div className="mb-6 space-y-4">
            <OddsLine
              sideA={{ label: event.side_a, total: sideAStats?.total ?? 0 }}
              sideB={{ label: event.side_b, total: sideBStats?.total ?? 0 }}
              stakeAmount={poolTotal}
              paymentType={isCash ? 'cash' : 'none'}
              size="large"
            />
            <ConfidenceBar
              sideA={{ label: event.side_a, total: sideAStats?.total ?? 0, avatars: sideAAvatars }}
              sideB={{ label: event.side_b, total: sideBStats?.total ?? 0, avatars: sideBAvatars }}
              size="large"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-6 pt-5 border-t border-[var(--color-border)]">
            <div className="min-w-0">
              <div className="eyebrow mb-1">Pool</div>
              <div className="stat-value truncate">
                {isCash ? (
                  <CountUp value={poolTotal} formatter="currency" />
                ) : (
                  <span className="inline-flex items-baseline gap-0.5">
                    <WMark />
                    <CountUp value={poolTotal} formatter="plain" />
                  </span>
                )}
              </div>
            </div>
            <div className="min-w-0">
              <div className="eyebrow mb-1">Bets</div>
              <div className="stat-value truncate">
                <CountUp value={event.total_bets} formatter="plain" />
              </div>
            </div>
          </div>
        </div>

        {isCancelled && (
          <div className="tone-pending tone-surface border rounded-xl p-4 mb-6 flex items-center gap-3">
            <span className="tone-dot shrink-0" />
            <p className="tone-text text-sm font-medium">
              This event&apos;s cancelled. Every stake is back in its owner&apos;s wallet.
            </p>
          </div>
        )}

        {event.status === 'resolved' && !isCancelled && netResults.length > 0 && (
          <div className="mb-6">
            <ResolutionBanner event={event} netResults={netResults} />
            {isCreator && (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handleUnresolve}
                  disabled={resolving}
                  className="btn-quiet-danger press disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resolving ? 'Unresolving…' : 'Unresolve event'}
                </button>
              </div>
            )}
          </div>
        )}

        {canResolve && (
          <div className="tone-neutral tone-surface border rounded-2xl p-4 sm:p-5 mb-6">
            <div className="section-head mb-3">
              <span className="eyebrow">Resolve market</span>
            </div>
            <p className="field-hint mb-3">Pick the side that won. This settles every bet.</p>
            <div className="flex gap-2 flex-wrap">
              {[
                { side: event.side_a, tone: 'tone-yes' },
                { side: event.side_b, tone: 'tone-no' },
              ].map(({ side, tone }) => (
                <button
                  key={side}
                  onClick={() => handleResolve(side)}
                  disabled={resolving}
                  className={`${tone} pill pill-solid press px-4 py-2 text-xs break-words disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {side} won
                </button>
              ))}
            </div>
            {isCash && (
              <div className="flex gap-2 flex-wrap mt-3">
                <button
                  onClick={handleCancel}
                  disabled={resolving}
                  className="btn-quiet-danger press disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel & refund all stakes
                </button>
              </div>
            )}
          </div>
        )}

        {/* Side cards — keep their yes/no identity via the tone system */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6">
          {[
            { side: event.side_a, tone: 'tone-yes' as const, pct: pctA },
            { side: event.side_b, tone: 'tone-no' as const, pct: pctB },
          ].map(({ side, tone, pct }) => {
            const stats = event.side_stats[side];
            return (
              <div key={side} className={`card card-interactive rail-top ${tone} p-5`}>
                <h3 className="tone-text font-semibold break-words leading-snug mb-2">{side}</h3>
                <div className="font-mono text-3xl sm:text-4xl font-medium tabular-nums tone-text">{pct}%</div>
                <div className="mt-4 pt-3 border-t border-[var(--color-border)] flex items-center justify-between gap-2 text-sm">
                  <span className="eyebrow">{stats.count} {stats.count === 1 ? 'bet' : 'bets'}</span>
                  <span className="stat-value text-lg">
                    {isCash ? `$${stats.total.toFixed(2)}` : <WAmount value={stats.total} />}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {event.status === 'active' && user && (
          <div className="mb-8">
            <BetForm
              sides={[event.side_a, event.side_b]}
              eventId={event.id}
              userId={user.id}
              username={username}
              onBetPlaced={fetchEvent}
              paymentType={event.payment_type}
              stakeAmount={event.stake_amount}
              onWalletChanged={fetchEvent}
            />
          </div>
        )}

        {/* The human zone: banter, reactions, the ledger of who's in — looser
            spacing than the sportsbook header above. */}
        <div className="mb-10">
          <div className="section-head mb-4">
            <span className="eyebrow">
              Comments{commentCount > 0 ? ` (${commentCount})` : ''}
            </span>
          </div>
          <CommentThread
            eventId={event.id}
            currentUserId={user?.id}
            currentUsername={username}
            canComment={!!user}
            onCountChange={setCommentCount}
          />
        </div>

        <div>
          <div className="section-head mb-4">
            <span className="eyebrow">Ledger</span>
          </div>
          <Ledger
            bets={event.bets}
            currentUserId={user?.id}
            onBetDeleted={fetchEvent}
            paymentType={event.payment_type}
            eventId={event.id}
            eventStatus={event.status}
            escrowByBet={event.escrow_by_bet}
          />
        </div>
      </div>
    </>
  );
}
