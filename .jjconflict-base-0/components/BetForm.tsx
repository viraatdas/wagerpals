'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface BetFormProps {
  sides: string[];
  eventId: string;
  userId: string;
  username: string;
  onBetPlaced: () => void;
  isPublic?: boolean;
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
  isPublic = false,
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

  const isCash = paymentType === 'cash';
  const isFixedStake = isCash && typeof stakeAmount === 'number' && stakeAmount > 0;

  const [fetchedBalance, setFetchedBalance] = useState<number | null>(null);
  const balance = typeof walletBalance === 'number' ? walletBalance : fetchedBalance;

  const fetchBalance = async () => {
    try {
      const response = await fetch(`/api/wallet?userId=${userId}`, {
        headers: { 'x-stack-user-id': userId },
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data && data.wallet && typeof data.wallet.balance === 'number') {
        setFetchedBalance(data.wallet.balance);
      }
    } catch (err) {
      // Silently ignore — do not block betting on a wallet fetch failure.
    }
  };

  useEffect(() => {
    if (isCash && typeof walletBalance !== 'number') {
      fetchBalance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCash, userId]);

  const effectiveStake = isFixedStake ? (stakeAmount as number) : parseFloat(amount) || 0;
  const insufficientFunds = isCash && typeof balance === 'number' && effectiveStake > 0 && balance < effectiveStake;

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
        headers: { 'Content-Type': 'application/json', 'x-stack-user-id': userId },
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
        const message = errorBody?.error || 'Failed to place bet. Please try again.';
        setError({ message, code: errorBody?.code, shortfall: errorBody?.shortfall });
        if (errorBody?.code === 'INSUFFICIENT_FUNDS' && typeof errorBody?.balance === 'number') {
          setFetchedBalance(errorBody.balance);
        }
        return;
      }

      setAmount('');
      setNote('');
      setError(null);
      onBetPlaced();
      onWalletChanged?.();
      if (isCash) {
        fetchBalance();
      }
    } catch (err) {
      console.error('Failed to place bet:', err);
      setError({ message: 'Failed to place bet. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const currencyLabel = isCash ? '$' : isPublic ? 'pts' : '$';

  const submitLabel = loading
    ? 'Placing...'
    : isCash
    ? effectiveStake > 0
      ? `Place $${effectiveStake.toFixed(2)} Bet`
      : 'Place Bet'
    : 'Place Bet';

  const submitDisabled =
    loading ||
    (isFixedStake ? !(stakeAmount && stakeAmount > 0) : !amount || parseFloat(amount) <= 0) ||
    !!insufficientFunds;

  return (
    <form onSubmit={handleSubmit} className="glass rounded-2xl p-4 sm:p-6 relative overflow-hidden animate-rise">
      <h3 className="font-display text-lg font-semibold text-foreground mb-4 border-b border-gray-200 pb-3 relative">
        Place Your <span className="text-gradient">Bet</span>
      </h3>

      <div className="space-y-5 sm:space-y-6 relative">
        <div>
          <label className="block text-sm font-medium text-muted mb-3">
            Pick a side
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {sides.map((side, i) => {
              const selected = selectedSide === side;
              const tone = i % 2 === 0 ? 'mint' : 'rose';
              const selectedClasses =
                tone === 'mint'
                  ? 'border-green-600 bg-green-50 text-green-700'
                  : 'border-red-600 bg-red-50 text-red-700';
              return (
                <button
                  key={side}
                  type="button"
                  onClick={() => {
                    setSelectedSide(side);
                    clearError();
                  }}
                  className={`relative px-4 py-3.5 rounded-xl font-semibold border transition-all break-words ${
                    selected
                      ? selectedClasses
                      : 'border-gray-200 bg-white text-foreground hover:bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  <span className="flex items-center justify-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full transition-all ${
                        selected
                          ? tone === 'mint'
                            ? 'bg-green-600'
                            : 'bg-red-600'
                          : 'bg-gray-300'
                      }`}
                    />
                    {side}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {isCash && (
          <div className="flex items-center justify-between text-sm bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <span className="text-muted font-medium">Wallet balance</span>
            <div className="flex items-center gap-3">
              <span className="tabular-nums font-semibold text-foreground">
                {typeof balance === 'number' ? `$${balance.toFixed(2)}` : '—'}
              </span>
              <Link href="/profile" className="text-brand-2 hover:underline text-sm font-medium">
                Add funds
              </Link>
            </div>
          </div>
        )}

        {isFixedStake ? (
          <div>
            <label className="block text-sm font-medium text-muted mb-3">
              Fixed stake
            </label>
            <div className="w-full flex items-center justify-between bg-gray-50 border border-gray-300 text-foreground rounded-xl px-3 py-2.5">
              <span className="text-muted font-medium">Stake</span>
              <span className="tabular-nums font-semibold">${(stakeAmount as number).toFixed(2)}</span>
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-muted mb-3">
              Amount ({currencyLabel})
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
              className="w-full bg-white border border-gray-300 text-foreground placeholder:text-muted-2 rounded-xl px-3 py-2.5 tabular-nums focus:outline-none focus:border-brand-2 focus:ring-2 focus:ring-brand-2/20 transition"
              inputMode="decimal"
              placeholder="10.00"
              required
            />
            {isCash && (
              <p className="text-sm text-muted-2 font-light mt-2">
                Your stake is held in escrow until the event resolves.
              </p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="note" className="block text-sm font-medium text-muted mb-3">
            Note (optional)
          </label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full bg-white border border-gray-300 text-foreground placeholder:text-muted-2 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-brand-2 focus:ring-2 focus:ring-brand-2/20 transition"
            placeholder="Your prediction or reasoning..."
          />
        </div>

        {error && error.code !== 'INSUFFICIENT_FUNDS' && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
            {error.message}
          </div>
        )}

        {(insufficientFunds || error?.code === 'INSUFFICIENT_FUNDS') && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
            <span>
              You need $
              {(
                error?.shortfall ?? Math.max(0, effectiveStake - (balance || 0))
              ).toFixed(2)}{' '}
              more to place this bet.
            </span>
            <Link href="/profile" className="btn-primary px-4 py-2 text-sm">
              Add funds
            </Link>
          </div>
        )}

        <button
          type="submit"
          disabled={submitDisabled}
          className="btn-primary w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
