'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bet, Comment, EscrowHold, EscrowHoldStatus, Transaction } from '@/lib/types';
import { formatTimestamp, formatAmount } from '@/lib/utils';
import ConfirmationModal from './ConfirmationModal';
import Toast, { ToastType } from './Toast';

interface LedgerProps {
  bets: Bet[];
  comments?: Comment[];
  currentUserId?: string;
  onBetDeleted?: () => void;
  onCommentDeleted?: () => void;
  isPublic?: boolean;
  paymentType?: 'none' | 'cash';
  eventId?: string;
  /**
   * Settling or cancelling an event moves money without changing the bet list,
   * so the wallet panel needs the status to know when to refetch.
   */
  eventStatus?: string;
  /**
   * Escrow status of every bet in this event, keyed by bet id, from
   * GET /api/events?id=. The viewer's wallet summary only carries the viewer's
   * own holds, so without this the escrow chips would appear on their bets and
   * nobody else's — reading as if other players had no money at stake.
   */
  escrowByBet?: Record<string, EscrowHoldStatus>;
}

type LedgerEntry = (Bet & { type: 'bet' }) | (Comment & { type: 'comment' });

/** Mirrors the payload of GET /api/wallet (see lib/payments.ts getWalletSummary). */
interface WalletSummary {
  wallet: { user_id: string; balance: number; currency: string };
  escrow_held_total: number;
  available: number;
  transactions?: Transaction[];
  event?: {
    escrow_held: number;
    holds: EscrowHold[];
    transactions: Transaction[];
    pot: number;
    settled: boolean;
  };
}

const TRANSACTION_LABELS: Record<string, { label: string; color: string }> = {
  escrow_hold: { label: 'Stake escrowed', color: 'text-red-600' },
  escrow_release: { label: 'Stake returned', color: 'text-green-700' },
  payout: { label: 'Winnings', color: 'text-green-700' },
  refund: { label: 'Refunded', color: 'text-green-700' },
  deposit: { label: 'Deposit', color: 'text-green-700' },
  withdrawal: { label: 'Withdrawal', color: 'text-red-600' },
};

function getTransactionLabel(type: string): { label: string; color: string } {
  return TRANSACTION_LABELS[type] || { label: type.replace(/_/g, ' '), color: 'text-muted' };
}

const HOLD_CHIPS: Record<EscrowHoldStatus, { label: string; className: string }> = {
  held: { label: 'Escrowed', className: 'text-amber-700 bg-amber-50 border-amber-200' },
  released: { label: 'Settled', className: 'text-gray-600 bg-gray-50 border-gray-200' },
  refunded: { label: 'Refunded', className: 'text-green-700 bg-green-50 border-green-200' },
};

/** Chips render on everyone's bets, so the tooltip has to name whose stake it is. */
function holdChipTitle(status: EscrowHoldStatus, isOwnBet: boolean, username: string): string {
  const stake = isOwnBet ? 'your stake' : `@${username}'s stake`;
  const Stake = isOwnBet ? 'Your stake' : stake;
  switch (status) {
    case 'held':
      return `${Stake} is held until this event is resolved or cancelled.`;
    case 'released':
      return `This event was resolved and ${stake} left escrow.`;
    case 'refunded':
      return `This event was cancelled and ${stake} was returned.`;
  }
}

export default function Ledger({ bets, comments = [], currentUserId, onBetDeleted, onCommentDeleted, isPublic = false, paymentType = 'none', eventId, eventStatus, escrowByBet }: LedgerProps) {
  const [deletingBets, setDeletingBets] = useState<Set<string>>(new Set());
  const [deletingComments, setDeletingComments] = useState<Set<string>>(new Set());
  const [betToDelete, setBetToDelete] = useState<string | null>(null);
  const [commentToDelete, setCommentToDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [walletSummary, setWalletSummary] = useState<WalletSummary | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState(false);
  const [walletReloadKey, setWalletReloadKey] = useState(0);

  const showWallet = paymentType === 'cash' && Boolean(currentUserId) && Boolean(eventId);
  // `bets` is a fresh array on every parent refetch, so key the effect off the
  // ids rather than the array identity to avoid refetching on every render.
  const betSignature = useMemo(() => bets.map(b => b.id).join(','), [bets]);

  useEffect(() => {
    if (!showWallet) {
      setWalletSummary(null);
      setWalletError(false);
      return;
    }

    let cancelled = false;
    setWalletLoading(true);

    fetch(`/api/wallet?userId=${currentUserId}&eventId=${eventId}`, {
      headers: { 'x-stack-user-id': currentUserId as string },
    })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to fetch wallet');
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setWalletSummary(data);
        setWalletError(false);
      })
      .catch((error) => {
        console.error('Failed to fetch wallet summary:', error);
        if (cancelled) return;
        setWalletSummary(null);
        setWalletError(true);
      })
      .finally(() => {
        if (!cancelled) setWalletLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eventStatus / betSignature / walletReloadKey are not read in the body —
    // they are the refetch triggers (settlement, a new bet, manual retry).
  }, [showWallet, currentUserId, eventId, eventStatus, betSignature, walletReloadKey]);

  const reloadWallet = useCallback(() => setWalletReloadKey(k => k + 1), []);

  // Escrow status per bet for EVERY player. The event payload is the source of
  // truth; the viewer's own holds are layered on top so a signed-in player
  // still sees their chips if an older event response predates escrow_by_bet.
  const holdStatusByBetId = useMemo(() => {
    const map = new Map<string, EscrowHoldStatus>(Object.entries(escrowByBet ?? {}));
    for (const hold of walletSummary?.event?.holds ?? []) {
      if (hold.bet_id) map.set(hold.bet_id, hold.status);
    }
    return map;
  }, [escrowByBet, walletSummary]);

  // Combine bets and comments
  const entries: LedgerEntry[] = [
    ...bets.map(bet => ({ ...bet, type: 'bet' as const })),
    ...comments.map(comment => ({ ...comment, type: 'comment' as const }))
  ].sort((a, b) => b.timestamp - a.timestamp);

  const handleDeleteBet = async (betId: string) => {
    setBetToDelete(betId);
  };

  const confirmDeleteBet = async () => {
    if (!betToDelete) return;

    setBetToDelete(null);
    setDeletingBets(prev => new Set(prev).add(betToDelete));

    try {
      const response = await fetch(`/api/bets?id=${betToDelete}`, {
        method: 'DELETE',
        headers: currentUserId ? { 'x-stack-user-id': currentUserId } : undefined,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete bet');
      }

      if (onBetDeleted) {
        onBetDeleted();
      }
      setToast({ message: 'Bet deleted successfully', type: 'success' });
    } catch (error: any) {
      console.error('Failed to delete bet:', error);
      setToast({ message: `Failed to delete bet: ${error.message}`, type: 'error' });
    } finally {
      setDeletingBets(prev => {
        const newSet = new Set(prev);
        newSet.delete(betToDelete);
        return newSet;
      });
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    setCommentToDelete(commentId);
  };

  const confirmDeleteComment = async () => {
    if (!commentToDelete) return;

    setCommentToDelete(null);
    setDeletingComments(prev => new Set(prev).add(commentToDelete));

    try {
      const response = await fetch(`/api/comments?id=${commentToDelete}`, {
        method: 'DELETE',
        headers: currentUserId ? { 'x-stack-user-id': currentUserId } : undefined,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete comment');
      }

      if (onCommentDeleted) {
        onCommentDeleted();
      }
      setToast({ message: 'Comment deleted successfully', type: 'success' });
    } catch (error: any) {
      console.error('Failed to delete comment:', error);
      setToast({ message: `Failed to delete comment: ${error.message}`, type: 'error' });
    } finally {
      setDeletingComments(prev => {
        const newSet = new Set(prev);
        newSet.delete(commentToDelete);
        return newSet;
      });
    }
  };

  const getBetDetails = (betId: string) => {
    const bet = bets.find(b => b.id === betId);
    if (!bet) return '';
    const currency = isPublic ? 'pts' : '$';
    return `@${bet.username}'s ${currency}${bet.amount.toFixed(2)} bet on ${bet.side}`;
  };

  const getCommentDetails = (commentId: string) => {
    const comment = comments.find(c => c.id === commentId);
    if (!comment) return '';
    return `@${comment.username}'s comment`;
  };

  return (
    <>
      <Toast
        isOpen={toast !== null}
        onClose={() => setToast(null)}
        message={toast?.message || ''}
        type={toast?.type || 'info'}
      />
      <ConfirmationModal
        isOpen={betToDelete !== null}
        onClose={() => setBetToDelete(null)}
        onConfirm={confirmDeleteBet}
        title="Delete Bet"
        message={`Are you sure you want to delete ${betToDelete ? getBetDetails(betToDelete) : 'this bet'}? This action cannot be undone.`}
        confirmText="Delete"
        type="danger"
        loading={betToDelete !== null && deletingBets.has(betToDelete)}
      />
      
      <ConfirmationModal
        isOpen={commentToDelete !== null}
        onClose={() => setCommentToDelete(null)}
        onConfirm={confirmDeleteComment}
        title="Delete Comment"
        message={`Are you sure you want to delete ${commentToDelete ? getCommentDetails(commentToDelete) : 'this comment'}? This action cannot be undone.`}
        confirmText="Delete"
        type="danger"
        loading={commentToDelete !== null && deletingComments.has(commentToDelete)}
      />
      
      {showWallet && (
        walletLoading && !walletSummary ? (
          <div className="skeleton h-24 rounded-2xl mb-4" />
        ) : walletError ? (
          <div className="glass rounded-2xl p-4 mb-4 border-amber-200 flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
            <p className="text-sm text-muted">Couldn&apos;t load your wallet for this event.</p>
            <button
              onClick={reloadWallet}
              className="text-sm font-medium text-brand-2 hover:underline self-start min-[420px]:self-auto"
            >
              Try again
            </button>
          </div>
        ) : walletSummary ? (
          <div className="glass-strong rounded-2xl p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-foreground">Your Wallet</h3>
              <Link href="/profile" className="text-brand-2 hover:underline text-sm font-medium">
                Add funds
              </Link>
            </div>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-muted-2 mb-1">Wallet balance</div>
                <div className="text-lg font-semibold text-foreground tabular-nums">
                  ${walletSummary.wallet.balance.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-2 mb-1">In escrow (this event)</div>
                <div className="text-lg font-semibold text-amber-700 tabular-nums">
                  ${(walletSummary.event?.escrow_held ?? 0).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-2 mb-1">Event pot</div>
                <div className="text-lg font-semibold text-brand-2 tabular-nums">
                  ${(walletSummary.event?.pot ?? 0).toFixed(2)}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-gray-200">
              <h4 className="text-xs font-semibold text-muted-2 uppercase tracking-wide mb-2">
                Settled history
              </h4>
              {walletSummary.event && walletSummary.event.transactions.length > 0 ? (
                <div className="space-y-1.5">
                  {walletSummary.event.transactions.map((t) => {
                    const { label, color } = getTransactionLabel(t.type);
                    return (
                      <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className={color}>{label}</span>
                        <div className="flex items-center gap-2">
                          <span className={`font-medium tabular-nums ${color}`}>
                            {formatAmount(t.amount)}
                          </span>
                          {t.created_at && (
                            <span className="text-xs text-muted-2 tabular-nums">
                              {formatTimestamp(new Date(t.created_at).getTime())}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-2">No settled activity yet.</p>
              )}
            </div>
          </div>
        ) : null
      )}

      <div className="space-y-3">
        {entries.length === 0 ? (
          <p className="text-muted-2 text-center py-8">No entries yet. Be the first!</p>
        ) : (
          entries.map((entry) => {
            if (entry.type === 'bet') {
              const bet = entry;
              const holdStatus = holdStatusByBetId.get(bet.id);
              const holdChip = holdStatus ? HOLD_CHIPS[holdStatus] : null;
              return (
                <div
                  key={`bet-${bet.id}`}
                  className={`glass rounded-2xl p-4 ${
                    bet.is_late ? 'border-amber-300' : ''
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground break-all">@{bet.username}</span>
                        <span className="text-muted-2">→</span>
                        <span className="text-muted break-words">{bet.side}</span>
                        <span className="font-semibold text-foreground tabular-nums">
                          {paymentType !== 'cash' && isPublic ? `${bet.amount.toFixed(2)} pts` : `$${bet.amount.toFixed(2)}`}
                        </span>
                        {bet.is_late && (
                          <span className="chip text-amber-700 bg-amber-50 border-amber-200">
                            Late
                          </span>
                        )}
                        {holdChip && holdStatus && (
                          <span
                            className={`chip ${holdChip.className}`}
                            title={holdChipTitle(holdStatus, bet.user_id === currentUserId, bet.username)}
                          >
                            {holdChip.label}
                          </span>
                        )}
                      </div>
                      {bet.note && (
                        <p className="text-sm text-muted mt-2 italic">
                          "{bet.note}"
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                      <span className="text-xs text-muted-2 tabular-nums">
                        {formatTimestamp(bet.timestamp)}
                      </span>
                      {/* Cash bets have money escrowed against them, so they
                          cannot be deleted — the escrow chip above says why. */}
                      {paymentType !== 'cash' && (
                        <button
                          onClick={() => handleDeleteBet(bet.id)}
                          disabled={deletingBets.has(bet.id)}
                          className="text-xs text-muted-2 hover:text-red-600 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete bet"
                        >
                          {deletingBets.has(bet.id) ? 'Deleting...' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            } else {
              const comment = entry;
              return (
                <div
                  key={`comment-${comment.id}`}
                  className="glass rounded-2xl p-4 border-sky-200"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="font-semibold text-foreground break-all">@{comment.username}</span>
                        <span className="chip text-sky-700 bg-sky-50 border-sky-200">
                          💬 Comment
                        </span>
                      </div>
                      <p className="text-sm text-muted break-words">
                        {comment.content}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                      <span className="text-xs text-muted-2 tabular-nums">
                        {formatTimestamp(comment.timestamp)}
                      </span>
                      <button
                        onClick={() => handleDeleteComment(comment.id)}
                        disabled={deletingComments.has(comment.id)}
                        className="text-xs text-muted-2 hover:text-red-600 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Delete comment"
                      >
                        {deletingComments.has(comment.id) ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
          })
        )}
      </div>
    </>
  );
}
