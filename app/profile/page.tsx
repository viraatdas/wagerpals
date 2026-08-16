
'use client';
export const dynamic = 'force-dynamic';


import { useEffect, useState } from 'react';
import { useUser } from '@stackframe/stack';
import { useRouter } from 'next/navigation';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import Toast, { ToastType } from '@/components/Toast';
import { validateUsername } from '@/lib/utils';
import { subscribeToWebPush } from '@/components/PushNotificationPrompt';

type NotificationCategoryKey =
  | 'bets'
  | 'comments'
  | 'mentions'
  | 'resolutions'
  | 'invites'
  | 'payments';

interface NotificationPreferencesState {
  user_id: string;
  push_enabled: boolean;
  email_enabled: boolean;
  categories: Record<string, boolean>;
  updated_at?: string;
}

const NOTIFICATION_CATEGORY_OPTIONS: { key: NotificationCategoryKey; label: string; hint: string }[] = [
  { key: 'bets', label: 'New bets', hint: 'Someone places a bet on a market you’re in.' },
  { key: 'comments', label: 'Comments', hint: 'New comments on markets you’re watching.' },
  { key: 'mentions', label: 'Mentions', hint: 'Someone @mentions you in a comment.' },
  { key: 'resolutions', label: 'Resolutions', hint: 'A market you bet on gets resolved.' },
  { key: 'invites', label: 'Group invites', hint: 'You’re invited to join a new group.' },
  { key: 'payments', label: 'Payouts', hint: 'A payout lands in your wallet.' },
];

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

export default function ProfilePage() {
  const user = useUser({ or: "return-null" });
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<any>(null);
  const [newUsername, setNewUsername] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [wallet, setWallet] = useState<{ balance: number } | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [walletDataLoading, setWalletDataLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [walletAction, setWalletAction] = useState<'none' | 'deposit' | 'withdraw'>('none');
  const [walletLoading, setWalletLoading] = useState(false);
  const [depositClientSecret, setDepositClientSecret] = useState<string | null>(null);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferencesState | null>(null);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [notifSavingKeys, setNotifSavingKeys] = useState<Set<string>>(new Set());
  const [deviceEnabled, setDeviceEnabled] = useState<boolean | null>(null);
  const [deviceEnabling, setDeviceEnabling] = useState(false);

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
      return;
    }
    fetchUserData();
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
  }, [user, router]);

  useEffect(() => {
    if (!user) return;
    fetchNotificationPreferences();
    checkDeviceSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchNotificationPreferences = async () => {
    if (!user) return;
    setNotifLoading(true);
    setNotifError(null);
    try {
      const response = await fetch('/api/push/preferences', {
        credentials: 'same-origin',
      });
      if (response.ok) {
        const data = await response.json();
        setNotifPrefs(data);
      }
    } catch (error) {
      console.error('Failed to fetch notification preferences:', error);
    } finally {
      setNotifLoading(false);
    }
  };

  const checkDeviceSubscription = async () => {
    if (typeof window === 'undefined') return;
    try {
      if (
        typeof Notification === 'undefined' ||
        Notification.permission !== 'granted' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        setDeviceEnabled(false);
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setDeviceEnabled(!!subscription);
    } catch (error) {
      console.error('Failed to check device subscription:', error);
      setDeviceEnabled(false);
    }
  };

  const handleEnableOnDevice = async () => {
    setDeviceEnabling(true);
    try {
      const success = await subscribeToWebPush();
      setDeviceEnabled(success);
    } finally {
      setDeviceEnabling(false);
    }
  };

  const handleToggleMasterNotifications = async () => {
    if (!notifPrefs || notifSavingKeys.has('push_enabled')) return;
    const previous = notifPrefs;
    const nextValue = !notifPrefs.push_enabled;

    setNotifSavingKeys((prev) => new Set(prev).add('push_enabled'));
    setNotifError(null);
    setNotifPrefs({ ...notifPrefs, push_enabled: nextValue });

    try {
      const response = await fetch('/api/push/preferences', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ push_enabled: nextValue }),
      });
      if (response.ok) {
        const data = await response.json();
        setNotifPrefs(data);
      } else {
        setNotifPrefs(previous);
        setNotifError('Failed to update notification setting.');
      }
    } catch (error) {
      setNotifPrefs(previous);
      setNotifError('Failed to update notification setting.');
    } finally {
      setNotifSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete('push_enabled');
        return next;
      });
    }
  };

  const handleToggleCategory = async (key: NotificationCategoryKey) => {
    if (!notifPrefs || notifSavingKeys.has(key) || !notifPrefs.push_enabled) return;
    const previous = notifPrefs;
    const nextValue = !notifPrefs.categories?.[key];

    setNotifSavingKeys((prev) => new Set(prev).add(key));
    setNotifError(null);
    setNotifPrefs({
      ...notifPrefs,
      categories: { ...notifPrefs.categories, [key]: nextValue },
    });

    try {
      const response = await fetch('/api/push/preferences', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: { [key]: nextValue } }),
      });
      if (response.ok) {
        const data = await response.json();
        setNotifPrefs(data);
      } else {
        setNotifPrefs(previous);
        setNotifError('Failed to update notification setting.');
      }
    } catch (error) {
      setNotifPrefs(previous);
      setNotifError('Failed to update notification setting.');
    } finally {
      setNotifSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const fetchUserData = async () => {
    if (!user) return;
    
    try {
      const response = await fetch(`/api/users?id=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setUserData(data);
        setNewUsername(data.username);
      }
    } catch (error) {
      console.error('Failed to fetch user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchWallet = async () => {
    if (!user) return;
    try {
      const response = await fetch(`/api/wallet?userId=${user.id}`, {
        headers: { 'x-stack-user-id': user.id },
      });
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

  const handleWalletAction = async (action: 'deposit' | 'withdraw') => {
    if (!user) return;
    const amount = action === 'deposit' ? depositAmount : withdrawAmount;
    if (!amount || parseFloat(amount) <= 0) return;

    if (action === 'deposit' && !stripePromise) {
      setToast({ message: 'Stripe is not configured for deposits.', type: 'error' });
      return;
    }

    setWalletLoading(true);
    try {
      const response = await fetch('/api/wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stack-user-id': user.id,
        },
        body: JSON.stringify({ user_id: user.id, action, amount }),
      });

      const data = await response.json();

      if (response.ok) {
        if (action === 'deposit' && data.clientSecret) {
          setDepositClientSecret(data.clientSecret);
          setToast({ message: 'Enter your payment details to complete the deposit.', type: 'info' });
        } else {
          setToast({ message: `${action === 'withdraw' ? 'Withdrawal' : 'Deposit'} successful!`, type: 'success' });
          setWalletAction('none');
          setDepositAmount('');
          setWithdrawAmount('');
          setDepositClientSecret(null);
          fetchWallet();
        }
      } else {
        setToast({ message: data.error || 'Transaction failed', type: 'error' });
      }
    } catch {
      setToast({ message: 'Transaction failed', type: 'error' });
    } finally {
      setWalletLoading(false);
    }
  };

  const resetWalletForm = () => {
    setWalletAction('none');
    setDepositAmount('');
    setWithdrawAmount('');
    setDepositClientSecret(null);
  };

  const handleDepositComplete = async () => {
    setToast({ message: 'Deposit complete. Your balance will update shortly.', type: 'success' });
    resetWalletForm();
    await fetchWallet();
    setTimeout(fetchWallet, 1500);
  };

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setNewUsername(value);
    
    // Real-time validation
    if (value.trim().length > 0 && value !== userData?.username) {
      const validation = validateUsername(value);
      setError(validation.valid ? null : validation.error || null);
    } else {
      setError(null);
    }
  };

  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newUsername.trim() || newUsername === userData?.username) return;

    const validation = validateUsername(newUsername);
    if (!validation.valid) {
      setError(validation.error || 'Invalid username');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: user.id,
          username: newUsername.trim(),
          username_selected: true,
        }),
      });

      if (response.ok) {
        const updated = await response.json();
        setUserData(updated);
        setEditing(false);
        setToast({ message: 'Username updated successfully!', type: 'success' });
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to update username');
      }
    } catch (error: any) {
      setError('Failed to update username');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-shell mobile-page">
        <div className="card-focal p-6 sm:p-8 mb-8">
          <div className="flex items-center gap-4">
            <div className="skeleton h-16 w-16 sm:h-20 sm:w-20 rounded-full flex-none" />
            <div className="flex-1 space-y-3">
              <div className="skeleton-line w-24" />
              <div className="skeleton-line w-40 h-6" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-8">
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
        </div>
        <div className="skeleton h-48 rounded-2xl mb-8" />
        <div className="skeleton h-40 rounded-2xl" />
      </div>
    );
  }

  if (!user || !userData) {
    return null;
  }

  return (
    <>
      <Toast
        isOpen={toast !== null}
        onClose={() => setToast(null)}
        message={toast?.message || ''}
        type={toast?.type || 'info'}
      />

      <div className="page-shell mobile-page animate-rise">
        {/* Identity header — the page's focal point */}
        <div className="card-focal hero-field p-6 sm:p-8 mb-8 overflow-hidden">
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-16 w-16 sm:h-20 sm:w-20 flex-none items-center justify-center rounded-full bg-[--color-accent-fill] text-2xl sm:text-3xl font-display font-bold text-[--color-accent-hover]">
                {userData.username?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <p className="eyebrow mb-1 truncate">{user.primaryEmail}</p>
                <h1 className="display-2 truncate">@{userData.username}</h1>
              </div>
            </div>
            <div className="sm:text-right">
              <p className="eyebrow mb-1 sm:text-right">Lifetime net</p>
              <p
                className={`numeral text-4xl sm:text-5xl tone-text ${
                  userData.net_total > 0 ? 'tone-win' : userData.net_total < 0 ? 'tone-loss' : 'tone-neutral'
                }`}
              >
                {userData.net_total > 0 ? '+' : userData.net_total < 0 ? '-' : ''}$
                {Math.abs(userData.net_total || 0).toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="mb-8">
          <div className="section-head mb-4">
            <span className="eyebrow">Stats</span>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <div className="card p-4 sm:p-5">
              <p className="eyebrow mb-2">Total Wagered</p>
              <p className="stat-value break-words">${userData.total_bet?.toFixed(2) || '0.00'}</p>
            </div>
            <div className="card p-4 sm:p-5">
              <p className="eyebrow mb-2">Net Total</p>
              <p
                className={`stat-value tone-text break-words ${
                  userData.net_total > 0 ? 'tone-win' : userData.net_total < 0 ? 'tone-loss' : 'tone-neutral'
                }`}
              >
                {userData.net_total > 0 ? '+' : userData.net_total < 0 ? '-' : ''}$
                {Math.abs(userData.net_total || 0).toFixed(2)}
              </p>
            </div>
            <div className="card p-4 sm:p-5">
              <p className="eyebrow mb-2">Win Streak</p>
              <p className="stat-value">🔥 {userData.streak || 0}</p>
            </div>
          </div>
        </div>

        {/* Profile / username */}
        <div className="mb-8">
          <div className="section-head mb-4">
            <span className="eyebrow">Profile</span>
          </div>
          <div className="card p-4 sm:p-6">
            {!editing ? (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="display-3 mb-1 truncate">@{userData.username}</p>
                  <p className="field-hint">
                    This is how you appear on the ledger and throughout the app
                  </p>
                </div>
                <button
                  onClick={() => setEditing(true)}
                  className="btn-primary px-4 py-2 whitespace-nowrap self-start sm:self-auto"
                >
                  Change Username
                </button>
              </div>
            ) : (
              <form onSubmit={handleSaveUsername}>
                <div className="mb-4">
                  <label htmlFor="username" className="field-label">
                    Username
                  </label>
                  <input
                    id="username"
                    type="text"
                    value={newUsername}
                    onChange={handleUsernameChange}
                    className={`input ${error ? 'input-invalid' : ''}`}
                    placeholder="new username"
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    required
                    aria-invalid={!!error}
                    aria-describedby={error ? 'username-error' : 'username-hint'}
                  />
                  {error ? (
                    <p id="username-error" className="tone-no tone-text text-sm mt-2 break-words">
                      {error}
                    </p>
                  ) : (
                    <p id="username-hint" className="field-hint mt-2">
                      Letters, numbers, and underscores only
                    </p>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setNewUsername(userData.username);
                      setError(null);
                    }}
                    className="btn-glass flex-1 px-4 py-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !!error || newUsername === userData.username}
                    className="btn-primary flex-1 px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Wallet */}
        <div id="wallet" className="scroll-mt-24 mb-8">
          <div className="section-head mb-4">
            <span className="eyebrow">Wallet</span>
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
            <div className="numeral text-4xl sm:text-5xl mb-5">
              ${wallet?.balance?.toFixed(2) || '0.00'}
            </div>
            {!stripePromise && (
              <div className="tone-pending tone-surface border rounded-xl px-3 py-2 text-sm mb-4">
                <span className="tone-text">
                  Card deposits are not configured yet. Add Stripe keys in Vercel to enable live wallet funding.
                </span>
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
                  Deposit with Card
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
                    appearance: {
                      theme: 'stripe',
                      variables: {
                        colorPrimary: '#2563eb',
                        colorBackground: '#ffffff',
                        colorText: '#1e2530',
                        colorTextSecondary: '#6b7280',
                        colorTextPlaceholder: '#9ca3af',
                        colorDanger: '#dc2626',
                        borderRadius: '12px',
                        fontFamily: 'Inter, system-ui, sans-serif',
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
                  {walletAction === 'deposit' ? 'Deposit amount, then card form opens' : 'Withdraw amount'}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1 relative">
                    <label htmlFor="wallet-amount" className="sr-only">
                      {walletAction === 'deposit' ? 'Deposit amount' : 'Withdraw amount'}
                    </label>
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
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
                    {walletLoading ? '...' : 'Go'}
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
        </div>

        {/* Transactions ledger */}
        <div className="mb-8">
          <div className="section-head mb-4">
            <span className="eyebrow">Transactions</span>
          </div>
          {walletDataLoading ? (
            <div className="card divide-y divide-[--color-border]">
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
          ) : transactions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h.01M11 15h2M5 7h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z" />
                </svg>
              </div>
              <p className="empty-state-title">No transactions yet</p>
              <p className="empty-state-body">
                Deposit to fund your wallet, and every bet, win, and payout will show up here.
              </p>
              <button
                onClick={() => setWalletAction('deposit')}
                className="btn-primary px-4 py-2 mt-1"
              >
                Make a deposit
              </button>
            </div>
          ) : (
            <div className="card divide-y divide-[--color-border]">
              {transactions.slice(0, 5).map((tx: any) => (
                <div key={tx.id} className={`flex items-center gap-3 px-4 py-3 ${txTone(tx)}`}>
                  <span className="tone-dot" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">{tx.description || tx.type}</p>
                    {tx.created_at && (
                      <p className="text-xs text-muted">{formatTxTimestamp(tx.created_at)}</p>
                    )}
                  </div>
                  <span className="numeral tone-text text-base whitespace-nowrap">
                    {tx.amount > 0 ? '+' : '-'}${Math.abs(tx.amount).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="mb-8">
          <div className="section-head mb-4">
            <span className="eyebrow">Notifications</span>
          </div>
          <div className="card p-4 sm:p-6">
            {notifLoading ? (
              <div className="space-y-3">
                <div className="skeleton h-10 rounded-2xl" />
                <div className="skeleton h-10 rounded-2xl" />
                <div className="skeleton h-10 rounded-2xl" />
              </div>
            ) : !notifPrefs ? (
              <p className="text-sm text-muted">Unable to load notification preferences right now.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 pb-4 border-b border-[--color-border]">
                  <div>
                    <p id="notif-master-label" className="text-sm font-medium text-foreground">
                      Push notifications
                    </p>
                    <p className="field-hint mt-0.5">
                      Master switch — turning this off disables every push notification below.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={notifPrefs.push_enabled}
                    onChange={handleToggleMasterNotifications}
                    disabled={notifSavingKeys.has('push_enabled')}
                    label="Push notifications"
                    labelledBy="notif-master-label"
                  />
                </div>

                <div className="mt-4 space-y-4">
                  {NOTIFICATION_CATEGORY_OPTIONS.map(({ key, label, hint }) => (
                    <div
                      key={key}
                      className={`flex items-center justify-between gap-4 ${
                        !notifPrefs.push_enabled ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <p id={`notif-${key}-label`} className="text-sm text-foreground">
                          {label}
                        </p>
                        <p className="field-hint mt-0.5">{hint}</p>
                      </div>
                      <ToggleSwitch
                        checked={!!notifPrefs.categories?.[key]}
                        onChange={() => handleToggleCategory(key)}
                        disabled={!notifPrefs.push_enabled || notifSavingKeys.has(key)}
                        label={label}
                        labelledBy={`notif-${key}-label`}
                      />
                    </div>
                  ))}
                </div>

                {notifError && (
                  <p className="tone-no tone-text text-sm mt-3">{notifError}</p>
                )}

                <div className="mt-5 pt-4 border-t border-[--color-border]">
                  {deviceEnabled ? (
                    <p className="text-sm text-muted">Notifications are enabled on this device.</p>
                  ) : (
                    <button
                      onClick={handleEnableOnDevice}
                      disabled={deviceEnabling}
                      className="btn-glass text-sm px-4 py-2 disabled:opacity-50"
                    >
                      {deviceEnabling ? 'Enabling...' : 'Enable on this device'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Account */}
        <div>
          <div className="section-head mb-4">
            <span className="eyebrow">Account</span>
          </div>
          <div className="card p-4 sm:p-6 space-y-3">
            <div>
              <p className="eyebrow mb-1">Email</p>
              <p className="text-foreground break-words">{user.primaryEmail}</p>
            </div>
            <div>
              <p className="eyebrow mb-1">User ID</p>
              <p className="text-muted text-xs sm:text-sm font-mono break-all">{user.id}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
  labelledBy,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
  labelledBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={onChange}
      className={`press relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-[--color-accent]' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-flex h-4 w-4 transform items-center justify-center rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      >
        {checked && (
          <svg
            viewBox="0 0 12 12"
            className="h-2.5 w-2.5 text-[--color-accent]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 6.2l2.2 2.2 4.3-5" />
          </svg>
        )}
      </span>
    </button>
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
        return_url: `${window.location.origin}/profile`,
      },
      redirect: 'if_required',
    });

    if (error) {
      onError(error.message || 'Payment failed');
      setLoading(false);
      return;
    }

    if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
      await onSuccess();
    } else {
      onError('Payment was not completed.');
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
          {loading ? 'Processing...' : 'Pay'}
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
