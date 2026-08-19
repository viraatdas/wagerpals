'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bet, EscrowHold, EscrowHoldStatus, Transaction } from '@/lib/types';
import { formatTimestamp, formatAmount } from '@/lib/utils';
import { formatW } from '@/lib/odds';
import ConfirmationModal from './ConfirmationModal';
import Toast, { ToastType } from './Toast';
import AvatarStack from './AvatarStack';
import EmptySlip from './EmptySlip';
import WAmount from './WMark';

interface LedgerProps {
  bets: Bet[];
  currentUserId?: string;
  onBetDeleted?: () => void;
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

const TRANSACTION_LABELS: Record<string, { label: string; tone: string }> = {
  escrow_hold: { label: 'Stake escrowed', tone: 'tone-pending' },
  escrow_release: { label: 'Stake returned', tone: 'tone-yes' },
  payout: { label: 'Winnings', tone: 'tone-gold' },
  refund: { label: 'Refunded', tone: 'tone-yes' },
  deposit: { label: 'Deposit', tone: 'tone-yes' },
  withdrawal: { label: 'Withdrawal', tone: 'tone-no' },
};

function getTransactionLabel(type: string): { label: string; tone: string } {
  return TRANSACTION_LABELS[type] || { label: type.replace(/_/g, ' '), tone: 'tone-neutral' };
}

// Escrow status is money state, not a person, so it stays out of the amber
// "people" palette — quiet neutral tones, with a small emerald accent only
// once money is actually back with its owner (refunded). Structured chip
// shape (rounded-chip, not a full pill) per the redesign's shape language:
// this describes a state a number is in, not a person or a page-level status.
const HOLD_CHIPS: Record<EscrowHoldStatus, { label: string; classes: string }> = {
  held: { label: 'Escrowed', classes: 'border-line bg-card text-ink-muted' },
  released: { label: 'Settled', classes: 'border-line bg-card text-ink-secondary' },
  refunded: { label: 'Refunded', classes: 'border-emerald/30 bg-emerald/10 text-emerald' },
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

export default function Ledger({ bets, currentUserId, onBetDeleted, paymentType = 'none', eventId, eventStatus, escrowByBet }: LedgerProps) {
  const [deletingBets, setDeletingBets] = useState<Set<string>>(new Set());
  const [betToDelete, setBetToDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [walletSummary, setWalletSummary] = useState<WalletSummary | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState(false);
  const [walletReloadKey, setWalletReloadKey] = useState(0);

  // Settling an event changes the money without changing the bet list, so the
  // bet ids alone are not a sufficient refetch trigger.
  const betSignature = bets.map((b) => b.id).join(',');

  useEffect(() => {
    if (paymentType !== 'cash' || !currentUserId || !eventId) {
      setWalletSummary(null);
      setWalletError(false);
      return;
    }

    let cancelled = false;
    setWalletLoading(true);
    setWalletError(false);

    fetch(`/api/wallet?userId=${currentUserId}&eventId=${eventId}`)
      .then((response) => {
        if (!response.ok) throw new Error('Failed to fetch wallet');
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setWalletSummary(data);
      })
      .catch((error) => {
        console.error('Failed to fetch wallet summary:', error);
        if (!cancelled) {
          setWalletSummary(null);
          setWalletError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setWalletLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eventStatus / betSignature / walletReloadKey are not read in the body —
    // they are the refetch triggers (settlement, a new bet, manual retry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, eventId, paymentType, eventStatus, betSignature, walletReloadKey]);

  const reloadWallet = useCallback(() => setWalletReloadKey((k) => k + 1), []);

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

  // Newest first.
  const sortedBets = [...bets].sort((a, b) => b.timestamp - a.timestamp);

  // Best-effort side → tone mapping (Ledger only receives raw bets, not the
  // event's side_a/side_b) — first side seen reads as "yes", second as "no".
  const uniqueSides = Array.from(new Set(bets.map((b) => b.side)));
  const toneForSide = (side: string) => {
    const idx = uniqueSides.indexOf(side);
    return idx === 0 ? 'tone-yes' : idx === 1 ? 'tone-no' : 'tone-neutral';
  };

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
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Couldn't delete that bet. Try again.");
      }

      if (onBetDeleted) {
        onBetDeleted();
      }
      setToast({ message: 'Bet deleted', type: 'success' });
    } catch (error: any) {
      console.error('Failed to delete bet:', error);
      setToast({ message: "Couldn't delete that bet. Try again.", type: 'error' });
    } finally {
      setDeletingBets(prev => {
        const newSet = new Set(prev);
        newSet.delete(betToDelete);
        return newSet;
      });
    }
  };

  const getBetDetails = (betId: string) => {
    const bet = bets.find(b => b.id === betId);
    if (!bet) return '';
    const amountText = paymentType === 'cash' ? `$${bet.amount.toFixed(2)}` : formatW(bet.amount);
    return `@${bet.username}'s ${amountText} bet on ${bet.side}`;
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
        title="Delete bet"
        message={`Delete ${betToDelete ? getBetDetails(betToDelete) : 'this bet'}? This can't be undone.`}
        confirmText="Delete"
        loadingText="Deleting…"
        type="danger"
        loading={betToDelete !== null && deletingBets.has(betToDelete)}
      />

      {paymentType === 'cash' && currentUserId && eventId && (
        walletLoading ? (
          <div className="card rounded-2xl p-4 mb-4 space-y-3">
            <div className="skeleton-line w-1/3" />
            <div className="skeleton-line w-full" />
            <div className="skeleton-line w-2/3" />
          </div>
        ) : walletError ? (
          <div className="card rounded-2xl p-4 mb-4 flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
            <p className="text-sm text-muted">Couldn&apos;t load your wallet for this event.</p>
            <button
              onClick={reloadWallet}
              className="btn-quiet press text-sm font-medium self-start min-[420px]:self-auto"
            >
              Try again
            </button>
          </div>
        ) : walletSummary ? (
          <div className="card rounded-2xl p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="eyebrow">Your wallet</h3>
              <Link href="/profile" className="press text-accent hover:underline text-sm font-medium">
                Add funds
              </Link>
            </div>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-3">
              <div>
                <div className="eyebrow mb-1">Balance</div>
                <div className="numeral text-foreground text-xl">
                  ${walletSummary.wallet.balance.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="eyebrow mb-1">In escrow</div>
                <div className="numeral tone-text tone-pending text-xl">
                  ${(walletSummary.event?.escrow_held ?? 0).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="eyebrow mb-1">Event pot</div>
                <div className="numeral tone-text tone-accent text-xl">
                  ${(walletSummary.event?.pot ?? 0).toFixed(2)}
                </div>
              </div>
            </div>

            <div className="rule mt-4 mb-3" />
            <h4 className="eyebrow mb-2">Settled history</h4>
            {walletSummary.event && walletSummary.event.transactions.length > 0 ? (
              <div className="space-y-1.5">
                {walletSummary.event.transactions.map((t) => {
                  const { label, tone } = getTransactionLabel(t.type);
                  return (
                    <div key={t.id} className={`flex items-center justify-between gap-2 text-sm ${tone}`}>
                      <span className="tone-text truncate min-w-0">{label}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="numeral tone-text text-sm">
                          {formatAmount(t.amount)}
                        </span>
                        {t.created_at && (
                          <span className="text-xs text-muted tabular-nums">
                            {formatTimestamp(new Date(t.created_at).getTime())}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted">No settled activity yet.</p>
            )}
          </div>
        ) : null
      )}

      {sortedBets.length === 0 ? (
        <EmptySlip
          body="Pick a side and place the first bet."
          action={{ label: 'Place the first bet', href: '#bet-form' }}
        />
      ) : (
        <div className="card rounded-2xl overflow-hidden">
          <div className="stagger-rows">
            {sortedBets.map((bet) => {
              const holdStatus = holdStatusByBetId.get(bet.id);
              const holdChip = holdStatus ? HOLD_CHIPS[holdStatus] : null;
              return (
              <div
                key={bet.id}
                className="flex flex-col gap-1.5 px-4 py-3 border-b border-hairline last:border-b-0 hover:bg-surface-sunken/60 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <AvatarStack people={[{ username: bet.username }]} size="sm" className="shrink-0" />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="font-sans font-semibold text-foreground truncate max-w-[45%] shrink-0">@{bet.username}</span>
                    <span className="text-muted shrink-0 text-xs">on</span>
                    <span className={`truncate min-w-0 flex-1 ${toneForSide(bet.side)} tone-text`}>{bet.side}</span>
                  </div>
                  {bet.is_late && <span className="pill tone-pending shrink-0">Late</span>}
                  {holdChip && holdStatus && (
                    <span
                      className={`inline-flex items-center rounded-chip border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide shrink-0 ${holdChip.classes}`}
                      title={holdChipTitle(holdStatus, bet.user_id === currentUserId, bet.username)}
                    >
                      {holdChip.label}
                    </span>
                  )}
                  <span className={`text-base font-medium shrink-0 ${toneForSide(bet.side)} tone-text`}>
                    {paymentType === 'cash' ? (
                      <span className="font-mono tabular-nums">${bet.amount.toFixed(2)}</span>
                    ) : (
                      <WAmount value={bet.amount} />
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 pl-[2.125rem]">
                  <span className="text-xs text-muted italic truncate min-w-0">
                    {bet.note ? `"${bet.note}"` : ''}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted font-mono">
                      {formatTimestamp(bet.timestamp)}
                    </span>
                    {paymentType !== 'cash' && (
                      <button
                        onClick={() => handleDeleteBet(bet.id)}
                        disabled={deletingBets.has(bet.id)}
                        className="btn-quiet-danger press disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Delete bet"
                      >
                        {deletingBets.has(bet.id) ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
