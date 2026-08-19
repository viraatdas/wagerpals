'use client';

// The wallet UI — balance, deposit, withdraw, transaction ledger, Stripe
// Elements. Rendered from two mount points (app/wallet/page.tsx and the
// wallet section of app/profile/page.tsx) so the old
// `/profile?wallet=deposit#wallet` deep links keep working — see
// IA-DECISIONS.md #2. One component, two mount points; no forked logic.

import { useEffect, useState } from 'react';
import { useUser } from '@stackframe/stack';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import Toast, { ToastType } from '@/components/Toast';
import CountUp from '@/components/CountUp';
import EmptySlip from '@/components/EmptySlip';
import WAmount from '@/components/WMark';

function formatTxTimestamp(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function txTone(tx: any): string {
  if (tx.type === 'winnings' || tx.type === 'payout') return 'tone-gold';
  return tx.amount > 0 ? 'tone-win' : 'tone-loss';
}

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

export interface WalletPanelProps {
  className?: string;
}

export default function WalletPanel({ className }: WalletPanelProps) {
  const user = useUser({ or: 'return-null' });
  const [wallet, setWallet] = useState<{ balance: number; wp_balance?: number } | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [walletDataLoading, setWalletDataLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [walletAction, setWalletAction] = useState<'none' | 'deposit' | 'withdraw'>('none');
  const [walletLoading, setWalletLoading] = useState(false);
  const [depositClientSecret, setDepositClientSecret] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchWallet();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('wallet') === 'deposit') {
        setWalletAction('deposit');
        setTimeout(() => {
          document.getElementById('wallet')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchWallet = async () => {
    if (!user) return;
    try {
      const response = await fetch(`/api/wallet?userId=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setWallet(data.wallet);
        setTransactions(data.transactions || []);
      }
    } catch {
      // Wallet may not exist yet, that's fine
    } finally {
      setWalletDataLoading(false);
    }
  };

  const resetWalletForm = () => {
    setWalletAction('none');
    setDepositAmount('');
    setWithdrawAmount('');
    setDepositClientSecret(null);
  };

  const handleWalletAction = async (action: 'deposit' | 'withdraw') => {
    if (!user) return;
    const amount = action === 'deposit' ? depositAmount : withdrawAmount;
    if (!amount || parseFloat(amount) <= 0) return;

    if (action === 'deposit' && !stripePromise) {
      setToast({ message: "Card deposits aren't available right now.", type: 'error' });
      return;
    }

    setWalletLoading(true);
    try {
      const response = await fetch('/api/wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: user.id, action, amount }),
      });

      const data = await response.json();

      if (response.ok) {
        if (action === 'deposit' && data.clientSecret) {
          setDepositClientSecret(data.clientSecret);
          setToast({ message: 'Enter your card details to finish depositing.', type: 'info' });
        } else {
          setToast({ message: 'Withdrawn.', type: 'success' });
          setWalletAction('none');
          setDepositAmount('');
          setWithdrawAmount('');
          setDepositClientSecret(null);
          fetchWallet();
        }
      } else {
        setToast({ message: data.error || "Couldn't complete that. Try again.", type: 'error' });
      }
    } catch {
      setToast({ message: "Couldn't complete that. Try again.", type: 'error' });
    } finally {
      setWalletLoading(false);
    }
  };

  const handleDepositComplete = async () => {
    setToast({ message: 'Deposited. Your balance updates shortly.', type: 'success' });
    resetWalletForm();
    await fetchWallet();
    setTimeout(fetchWallet, 1500);
  };

  // Two separate ledgers, split by the payload's own currency field —
  // never mixed W and $ in one list. A transaction from before `currency`
  // existed on the row defaults to cash (undefined !== 'wp').
  const isGrant = (tx: any) => typeof tx.idempotency_key === 'string' && tx.idempotency_key.startsWith('signup-grant:');
  // The signup grant seeds the balance silently (owner: no "welcome bonus" row).
  const wpTransactions = transactions.filter((tx: any) => tx.currency === 'wp' && !isGrant(tx));
  const cashTransactions = transactions.filter((tx: any) => tx.currency !== 'wp');

  return (
    <div id="wallet" className={`scroll-mt-24 ${className ?? ''}`}>
      <Toast
        isOpen={toast !== null}
        onClose={() => setToast(null)}
        message={toast?.message || ''}
        type={toast?.type || 'info'}
      />

      {/* $ Cash — real money. Stripe deposits/withdrawals, kept a strictly
          $-only affair, visually separate from the W panel below it. */}
      <div className="section-head mb-4">
        <span className="eyebrow-accent eyebrow">$ Cash</span>
      </div>
      <div className="card p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="eyebrow">Available balance</p>
          <span className="pill tone-neutral">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h.01M11 15h2M5 7h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z" />
            </svg>
            USD
          </span>
        </div>
        <div
          className={`mb-5 text-4xl sm:text-5xl ${
            (wallet?.balance ?? 0) < 0 ? 'text-crimson-ink' : 'text-emerald'
          }`}
        >
          <CountUp value={wallet?.balance ?? 0} formatter="currency" className="font-mono" />
        </div>
        {!stripePromise && (
          <div className="tone-pending tone-surface border rounded-panel px-3 py-2 text-sm mb-4">
            <span className="tone-text">Card deposits aren&apos;t available right now.</span>
          </div>
        )}

        {walletAction === 'none' ? (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => setWalletAction('deposit')}
              className="btn-primary flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h.01M11 15h2M5 7h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z" />
              </svg>
              Deposit
            </button>
            <button
              onClick={() => setWalletAction('withdraw')}
              className="btn-glass flex-1 px-4 py-2.5"
            >
              Withdraw
            </button>
          </div>
        ) : depositClientSecret && stripePromise && walletAction === 'deposit' ? (
          <div className="panel p-3">
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret: depositClientSecret,
                // Stripe Elements renders in its own iframe and its appearance API
                // only accepts literal colour strings — CSS custom properties do not
                // cross that boundary. This is the documented exception to the
                // tokens-only rule (CLAUDE.md §8 / DESIGN-SPEC.md "Hard rules").
                // Light mode only now (dark mode was deleted) — values copied
                // from app/globals.css's canonical palette; keep in lockstep.
                appearance: {
                  theme: 'stripe',
                  variables: {
                    colorPrimary: '#0F7A4C', // --color-emerald
                    colorBackground: '#FFFFFF', // --color-card
                    colorText: '#1C1B17', // --color-ink
                    colorTextSecondary: '#575448', // --color-ink-secondary
                    colorTextPlaceholder: '#747060', // --color-ink-muted
                    colorDanger: '#D64545', // --color-crimson
                    borderRadius: '10px', // --radius-card
                    fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif',
                  },
                },
              }}
            >
              <DepositPaymentForm
                loading={walletLoading}
                setLoading={setWalletLoading}
                onSuccess={handleDepositComplete}
                onError={(message) => setToast({ message, type: 'error' })}
                onCancel={resetWalletForm}
              />
            </Elements>
          </div>
        ) : (
          <div className="panel p-3">
            <p className="field-hint mb-3">
              {walletAction === 'deposit' ? 'Enter a deposit amount' : 'Enter a withdraw amount'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1 relative">
                <label htmlFor="wallet-amount" className="sr-only">
                  {walletAction === 'deposit' ? 'Deposit amount' : 'Withdraw amount'}
                </label>
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">$</span>
                <input
                  id="wallet-amount"
                  type="number"
                  step="0.01"
                  min="1"
                  max="500"
                  value={walletAction === 'deposit' ? depositAmount : withdrawAmount}
                  onChange={(e) => walletAction === 'deposit' ? setDepositAmount(e.target.value) : setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  className="input pl-7"
                  autoFocus
                />
              </div>
              <button
                onClick={() => handleWalletAction(walletAction)}
                disabled={walletLoading}
                className="btn-primary w-full sm:w-auto px-5 py-2.5 disabled:opacity-50"
              >
                {walletLoading
                  ? walletAction === 'deposit' ? 'Depositing…' : 'Withdrawing…'
                  : walletAction === 'deposit' ? 'Deposit' : 'Withdraw'}
              </button>
              <button
                onClick={resetWalletForm}
                className="btn-glass w-full sm:w-auto px-3 py-2.5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* W — WagerPals' play currency. Never Stripe, never withdrawable,
          never interchangeable with $ — its own balance, its own recent
          transactions (the payload distinguishes currency per-transaction),
          and the faucet line. Amber never touches a money value, so this
          stays on the same emerald/crimson number treatment as $. */}
      <div className="section-head mb-4 mt-8">
        <span className="eyebrow-accent eyebrow">W</span>
      </div>
      <div className="card p-5 sm:p-7">
        <div className="mb-1 flex items-center justify-between gap-3">
          <p className="eyebrow">W balance</p>
        </div>
        {/* Small and inline per the owner — the $ cash balance stays the hero;
            W reads as a compact figure beside its label. */}
        <div className="mb-3 flex items-baseline gap-2">
          <span className="text-xl sm:text-2xl text-emerald">
            <WAmount value={wallet?.wp_balance ?? 0} animate className="font-mono" />
          </span>
          <span className="text-xs text-ink-muted">to stake</span>
        </div>
        <p className="field-hint mb-4">Out of W? You get W10 back every day.</p>

        {wpTransactions.length > 0 && (
          <div className="card divide-y divide-line">
            {wpTransactions.slice(0, 5).map((tx: any) => (
              <div key={tx.id} className={`flex items-center gap-3 px-4 py-3 ${txTone(tx)}`}>
                <span className="tone-dot" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate">{tx.description || tx.type}</p>
                  {tx.created_at && (
                    <p className="text-xs text-ink-muted">{formatTxTimestamp(tx.created_at)}</p>
                  )}
                </div>
                <span className="tone-text text-base whitespace-nowrap inline-flex items-baseline gap-0.5">
                  {tx.amount > 0 ? '+' : '-'}
                  <WAmount value={Math.abs(tx.amount)} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* $ Transactions ledger — cash only; W's own recent activity is in
          the panel above. */}
      <div className="mt-8">
        <div className="section-head mb-4">
          <span className="eyebrow">Transactions</span>
        </div>
        {walletDataLoading ? (
          <div className="card divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="skeleton h-2 w-2 rounded-full flex-none" />
                <div className="flex-1">
                  <div className="skeleton-line w-1/3" />
                </div>
                <div className="skeleton-line w-14" />
              </div>
            ))}
          </div>
        ) : cashTransactions.length === 0 ? (
          <EmptySlip
            headline="Nothing in the ledger yet."
            body="Deposit to fund your wallet. Every bet, win, and payout lands here."
            action={{ label: 'Make a deposit', onClick: () => setWalletAction('deposit') }}
          />
        ) : (
          <div className="card divide-y divide-line">
            {cashTransactions.slice(0, 5).map((tx: any) => (
              <div key={tx.id} className={`flex items-center gap-3 px-4 py-3 ${txTone(tx)}`}>
                <span className="tone-dot" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate">{tx.description || tx.type}</p>
                  {tx.created_at && (
                    <p className="text-xs text-ink-muted">{formatTxTimestamp(tx.created_at)}</p>
                  )}
                </div>
                <span className="font-mono tone-text text-base whitespace-nowrap">
                  {tx.amount > 0 ? '+' : '-'}${Math.abs(tx.amount).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DepositPaymentForm({
  loading,
  setLoading,
  onSuccess,
  onError,
  onCancel,
}: {
  loading: boolean;
  setLoading: (loading: boolean) => void;
  onSuccess: () => Promise<void>;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Wherever this panel is mounted (/wallet or /profile#wallet) — a
        // 3DS redirect should land the user back where they started.
        return_url: window.location.href,
      },
      redirect: 'if_required',
    });

    if (error) {
      onError(error.message || "Couldn't complete that deposit. Try again.");
      setLoading(false);
      return;
    }

    if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
      await onSuccess();
    } else {
      onError("Couldn't complete that deposit. Try again.");
    }

    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <PaymentElement />
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={!stripe || !elements || loading}
          className="btn-primary flex-1 px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Depositing…' : 'Deposit'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="btn-glass w-full sm:w-auto px-4 py-2.5 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
