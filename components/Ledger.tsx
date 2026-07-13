'use client';

import { useState } from 'react';
import { Bet, Comment } from '@/lib/types';
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
}

type LedgerEntry = (Bet & { type: 'bet' }) | (Comment & { type: 'comment' });

export default function Ledger({ bets, comments = [], currentUserId, onBetDeleted, onCommentDeleted, isPublic = false }: LedgerProps) {
  const [deletingBets, setDeletingBets] = useState<Set<string>>(new Set());
  const [deletingComments, setDeletingComments] = useState<Set<string>>(new Set());
  const [betToDelete, setBetToDelete] = useState<string | null>(null);
  const [commentToDelete, setCommentToDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  
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
                          {isPublic ? `${bet.amount.toFixed(2)} pts` : `$${bet.amount.toFixed(2)}`}
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
                      <button
                        onClick={() => handleDeleteBet(bet.id)}
                        disabled={deletingBets.has(bet.id)}
                        className="text-xs text-muted-2 hover:text-red-600 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Delete bet"
                      >
                        {deletingBets.has(bet.id) ? 'Deleting...' : 'Delete'}
                      </button>
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
