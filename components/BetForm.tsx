'use client';

import { useState } from 'react';

interface BetFormProps {
  sides: string[];
  eventId: string;
  userId: string;
  username: string;
  onBetPlaced: () => void;
  isPublic?: boolean;
}

export default function BetForm({ sides, eventId, userId, username, onBetPlaced, isPublic = false }: BetFormProps) {
  const [selectedSide, setSelectedSide] = useState(sides[0]);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;

    setLoading(true);

    try {
      const response = await fetch('/api/bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-stack-user-id': userId },
        body: JSON.stringify({
          event_id: eventId,
          user_id: userId,
          username,
          side: selectedSide,
          amount: Math.round(parseFloat(amount) * 100) / 100,
          note: note.trim() || undefined,
        }),
      });

      if (response.ok) {
        setAmount('');
        setNote('');
        onBetPlaced();
      }
    } catch (error) {
      console.error('Failed to place bet:', error);
    } finally {
      setLoading(false);
    }
  };

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
                  onClick={() => setSelectedSide(side)}
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

        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-muted mb-3">
            Amount ({isPublic ? 'pts' : '$'})
          </label>
          <input
            type="number"
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0.01"
            step="0.01"
            className="w-full bg-white border border-gray-300 text-foreground placeholder:text-muted-2 rounded-xl px-3 py-2.5 tabular-nums focus:outline-none focus:border-brand-2 focus:ring-2 focus:ring-brand-2/20 transition"
            inputMode="decimal"
            placeholder="10.00"
            required
          />
        </div>

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

        <button
          type="submit"
          disabled={loading || !amount || parseFloat(amount) <= 0}
          className="btn-primary w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {loading ? 'Placing...' : 'Place Bet'}
        </button>
      </div>
    </form>
  );
}
