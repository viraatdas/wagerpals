'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bet, Comment, EscrowHold, Transaction } from '@/lib/types';
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
}

type LedgerEntry = (Bet & { type: 'bet' }) | (Comment & { type: 'comment' });

interface WalletSummary {
  wallet: { user_id: string; balance: number; currency: string };
  escrow_held_total: number;
  available: number;
  transactions: Transaction[];
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
};

function getTransactionLabel(type: string): { label: string; color: string } {
  return TRANSACTION_LABELS[type] || { label: type.replace(/_/g, ' '), color: 'text-muted' };
}

export default function Ledger({ bets, comments = [], currentUserId, onBetDeleted, onCommentDeleted, isPublic = false, paymentType = 'none', eventId }: LedgerProps) {
  const [deletingBets, setDeletingBets] = useState<Set<string>>(new Set());
  const [deletingComments, setDeletingComments] = useState<Set<string>>(new Set());
  const [betToDelete, setBetToDelete] = useState<string | null>(null);
  const [commentToDelete, setCommentToDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [walletSummary, setWalletSummary] = useState<WalletSummary | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);

  useEffect(() => {
    if (paymentType !== 'cash' || !currentUserId || !eventId) {
      setWalletSummary(null);
      return;
    }

    let cancelled = false;
    setWalletLoading(true);

    fetch(`/api/wallet?userId=${currentUserId}&eventId=${eventId}`, {
      headers: { 'x-stack-user-id': currentUserId },
    })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to fetch wallet');
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setWalletSummary(data);
      })
      .catch((error) => {
        console.error('Failed to fetch wallet summary:', error);
        if (!cancelled) setWalletSummary(null);
      })
      .finally(() => {
        if (!cancelled) setWalletLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, eventId, paymentType, bets.length, bets.map(b => b.id).join(',')]);

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
      
      {paymentType === 'cash' && currentUserId && eventId && (
        walletLoading ? (
          <div className="skeleton h-24 rounded-2xl mb-4" />
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
