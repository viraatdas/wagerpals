'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatW } from '@/lib/odds';
import WAmount, { WMark } from './WMark';

interface BetFormProps {
  sides: string[];
  eventId: string;
  userId: string;
  username: string;
  onBetPlaced: () => void;
  paymentType?: 'none' | 'cash';
  stakeAmount?: number | null;
  walletBalance?: number | null;
  onWalletChanged?: () => void;
}

export default function BetForm({
  sides,
  eventId,
  userId,
  username,
  onBetPlaced,
  paymentType = 'none',
  stakeAmount = null,
  walletBalance,
  onWalletChanged,
}: BetFormProps) {
  const [selectedSide, setSelectedSide] = useState(sides[0]);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string; shortfall?: number } | null>(null);
  // Presentational only: shows a brief landed-stake confirmation after a successful submit.
  const [justPlaced, setJustPlaced] = useState<{ side: string; amount: number } | null>(null);

  const isCash = paymentType === 'cash';
  const isFixedStake = isCash && typeof stakeAmount === 'number' && stakeAmount > 0;

  // Cash and W are separate ledgers (see W-CURRENCY-SPEC.md) — fetch both so
  // insufficient-funds checks work on whichever currency this event stakes.
  const [fetchedBalance, setFetchedBalance] = useState<number | null>(null);
  const [fetchedWpBalance, setFetchedWpBalance] = useState<number | null>(null);
  const balance = typeof walletBalance === 'number' ? walletBalance : fetchedBalance;
  const wpBalance = fetchedWpBalance;

  const fetchBalance = async () => {
    try {
      const response = await fetch(`/api/wallet?userId=${userId}`);
      if (!response.ok) return;
      const data = await response.json();
      if (data && data.wallet && typeof data.wallet.balance === 'number') {
        setFetchedBalance(data.wallet.balance);
      }
      if (data && data.wallet && typeof data.wallet.wp_balance === 'number') {
        setFetchedWpBalance(data.wallet.wp_balance);
      }
    } catch (err) {
      // Silently ignore — do not block betting on a wallet fetch failure.
    }
  };

  useEffect(() => {
    if (!isCash || typeof walletBalance !== 'number') {
      fetchBalance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCash, userId]);

  // Clear the transient confirmation a couple seconds after it lands.
  useEffect(() => {
    if (!justPlaced) return;
    const t = setTimeout(() => setJustPlaced(null), 3200);
    return () => clearTimeout(t);
  }, [justPlaced]);

  const effectiveStake = isFixedStake ? (stakeAmount as number) : parseFloat(amount) || 0;
  const insufficientFunds = isCash
    ? typeof balance === 'number' && effectiveStake > 0 && balance < effectiveStake
    : typeof wpBalance === 'number' && effectiveStake > 0 && wpBalance < effectiveStake;

  const clearError = () => {
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const submittedAmount = isFixedStake ? (stakeAmount as number) : Math.round(parseFloat(amount) * 100) / 100;
    if (!submittedAmount || submittedAmount <= 0) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          user_id: userId,
          username,
          side: selectedSide,
          amount: submittedAmount,
          note: note.trim() || undefined,
        }),
      });

      if (!response.ok) {
        let errorBody: any = null;
        try {
          errorBody = await response.json();
        } catch {
          // ignore parse failure
        }
        const message = errorBody?.error || "Couldn't place that bet — try again.";
        setError({ message, code: errorBody?.code, shortfall: errorBody?.shortfall });
        if (errorBody?.code === 'INSUFFICIENT_FUNDS') {
          if (typeof errorBody?.balance === 'number') setFetchedBalance(errorBody.balance);
          if (typeof errorBody?.wp_balance === 'number') setFetchedWpBalance(errorBody.wp_balance);
        }
        return;
      }

      setJustPlaced({ side: selectedSide, amount: submittedAmount });
      setAmount('');
      setNote('');
      setError(null);
      onBetPlaced();
      onWalletChanged?.();
      fetchBalance();
    } catch (err) {
      console.error('Failed to place bet:', err);
      setError({ message: "Couldn't place that bet — try again." });
    } finally {
      setLoading(false);
    }
  };

  const submitLabelText =
    effectiveStake > 0
      ? isCash
        ? `Place $${effectiveStake.toFixed(2)} Bet`
        : `Place ${formatW(effectiveStake)} Bet`
      : 'Place Bet';
  const submitLabel = loading ? 'Placing bet…' : submitLabelText;

  const submitDisabled =
    loading ||
    (isFixedStake ? !(stakeAmount && stakeAmount > 0) : !amount || parseFloat(amount) <= 0) ||
    !!insufficientFunds;

  return (
    <form id="bet-form" onSubmit={handleSubmit} className="card rounded-2xl p-4 sm:p-6 relative overflow-hidden animate-rise">
      <div className="section-head mb-4">
        <h3 className="eyebrow">Place your bet</h3>
      </div>

      <div className="space-y-5 sm:space-y-6 relative">
        <div>
          <span className="field-label">Pick a side</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {sides.map((side, i) => {
              const selected = selectedSide === side;
              const tone = i % 2 === 0 ? 'tone-yes' : 'tone-no';
              return (
                <button
                  key={side}
                  type="button"
                  onClick={() => {
                    setSelectedSide(side);
                    clearError();
                  }}
                  aria-pressed={selected}
                  className={`press relative px-4 py-4 rounded-control font-semibold text-left break-words border-2 transition-colors ${
                    selected
                      ? `${tone} tone-surface`
                      : 'border-hairline bg-surface text-foreground hover:bg-surface-elevated hover:border-hairline-strong'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={`flex items-center gap-2 min-w-0 ${selected ? 'tone-text' : ''}`}>
                      <span className={`tone-dot ${tone}`} />
                      <span className="truncate">{side}</span>
                    </span>
                    {selected && (
                      <svg
                        className="tone-text w-4 h-4 shrink-0"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 10l4 4 8-8" />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {isCash ? (
          <div className="panel flex items-center justify-between text-sm px-4 py-3">
            <span className="eyebrow">Wallet balance</span>
            <div className="flex items-center gap-3">
              <span className="numeral text-lg text-foreground">
                {typeof balance === 'number' ? `$${balance.toFixed(2)}` : '—'}
              </span>
              <Link href="/profile" className="press text-accent hover:underline text-sm font-medium">
                Add funds
              </Link>
            </div>
          </div>
        ) : (
          <div className="panel flex items-center justify-between text-sm px-4 py-3">
            <span className="eyebrow">W balance</span>
            {typeof wpBalance === 'number' ? (
              <WAmount value={wpBalance} className="text-lg text-foreground" />
            ) : (
              <span className="numeral text-lg text-foreground">—</span>
            )}
          </div>
        )}

        {isFixedStake ? (
          <div>
            <span className="field-label">Fixed stake</span>
            <div className="panel w-full flex items-center justify-between px-3 py-2.5">
              <span className="text-muted font-medium text-sm">Stake</span>
              <span className="numeral text-xl text-foreground">${(stakeAmount as number).toFixed(2)}</span>
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="amount" className="field-label inline-flex items-center gap-1">
              Amount
              {isCash ? (
                <span>($)</span>
              ) : (
                <span className="inline-flex items-center gap-0.5" aria-label="(W)">
                  (<WMark className="h-2.5 w-2.5" />)
                </span>
              )}
            </label>
            <input
              type="number"
              id="amount"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                clearError();
              }}
              min="0.01"
              step="0.01"
              max={isCash ? '500' : undefined}
              className={`input numeral text-2xl ${error && error.code !== 'INSUFFICIENT_FUNDS' ? 'input-invalid' : ''}`}
              inputMode="decimal"
              placeholder="10.00"
              required
            />
            {isCash && (
              <p className="field-hint mt-2">
                We hold your stake in escrow until the event resolves.
              </p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="note" className="field-label">
            Note (optional)
          </label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="input resize-none"
            placeholder="Your prediction or reasoning…"
          />
        </div>

        {error && error.code !== 'INSUFFICIENT_FUNDS' && (
          <div className="tone-no tone-surface border rounded-xl p-3 text-sm tone-text">
            {error.message}
          </div>
        )}

        {(insufficientFunds || error?.code === 'INSUFFICIENT_FUNDS') && (
          isCash ? (
            <div className="tone-pending tone-surface border rounded-xl p-3 text-sm tone-text flex items-center justify-between gap-3 flex-wrap">
              <span>
                You need $
                {(
                  error?.shortfall ?? Math.max(0, effectiveStake - (balance || 0))
                ).toFixed(2)}{' '}
                more to place this bet.
              </span>
              <Link href="/profile" className="btn-primary press px-4 py-2 text-sm">
                Add funds
              </Link>
            </div>
          ) : (
            <div className="tone-pending tone-surface border rounded-xl p-3 text-sm tone-text space-y-1">
              <p>
                Not enough W — you have <WAmount value={wpBalance ?? 0} className="text-sm" />.
              </p>
              <p className="text-ink-muted">Out of W? You get W10 back every day.</p>
            </div>
          )
        )}

        {justPlaced && (
          <div className="tone-yes tone-surface border rounded-xl p-3 text-sm animate-bet-land flex items-center justify-between gap-3">
            <span className="tone-text font-medium">Bet placed on {justPlaced.side}</span>
            <span className="tone-text text-lg">
              {isCash ? (
                <span className="numeral">${justPlaced.amount.toFixed(2)}</span>
              ) : (
                <WAmount value={justPlaced.amount} />
              )}
            </span>
          </div>
        )}

        <button
          type="submit"
          disabled={submitDisabled}
          className="btn-primary press w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
