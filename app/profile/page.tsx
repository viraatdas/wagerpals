
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

const NOTIFICATION_CATEGORY_OPTIONS: { key: NotificationCategoryKey; label: string }[] = [
  { key: 'bets', label: 'New bets' },
  { key: 'comments', label: 'Comments' },
  { key: 'mentions', label: 'Mentions' },
  { key: 'resolutions', label: 'Resolutions' },
  { key: 'invites', label: 'Group invites' },
  { key: 'payments', label: 'Payouts' },
];

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
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="skeleton h-10 w-40 rounded-2xl" />
        <div className="skeleton h-32 rounded-3xl" />
        <div className="skeleton h-48 rounded-3xl" />
        <div className="skeleton h-32 rounded-3xl" />
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

      <div className="max-w-4xl mx-auto px-4 py-8 mobile-page animate-rise">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold mb-2">
          <span className="text-gradient">Profile</span>
        </h1>
        <p className="text-muted mb-8">
          Manage your account settings
        </p>

        {/* Username Card */}
        <div className="glass rounded-3xl p-4 sm:p-6 mb-6">
          <h2 className="font-display text-xl font-semibold text-foreground mb-4">Username</h2>

          {!editing ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-xl sm:text-2xl font-semibold text-foreground mb-1 break-words">@{userData.username}</p>
                <p className="text-sm text-muted-2">
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
                <input
                  type="text"
                  value={newUsername}
                  onChange={handleUsernameChange}
                  className={`w-full px-3 py-3 text-base sm:text-lg bg-white border text-foreground placeholder:text-muted-2 rounded-xl outline-none transition focus:ring-2 ${
                    error ? 'border-red-300 focus:ring-red-100' : 'border-gray-200 focus:border-blue-400 focus:ring-blue-100'
                  }`}
                  placeholder="new username"
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  required
                />
                {error && (
                  <p className="text-red-600 text-sm mt-2 break-words">{error}</p>
                )}
                <p className="text-xs text-muted-2 mt-2">
                  Letters, numbers, and underscores only
                </p>
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

        {/* Wallet Card */}
        <div id="wallet" className="scroll-mt-24 glass-strong rounded-4xl p-5 sm:p-7 mt-6 relative overflow-hidden shadow-glow">
          <div className="absolute inset-x-0 -top-px h-px bg-brand-gradient opacity-60" />
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-display text-xl font-semibold text-foreground">Wallet</h2>
            <span className="chip">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h.01M11 15h2M5 7h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z" />
              </svg>
              USD
            </span>
          </div>
          <div className="text-4xl sm:text-5xl font-display font-semibold text-gradient mb-1 tabular-nums">
            ${wallet?.balance?.toFixed(2) || '0.00'}
          </div>
          <p className="text-muted-2 text-sm mb-5">Available balance</p>
          {!stripePromise && (
            <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
              Card deposits are not configured yet. Add Stripe keys in Vercel to enable live wallet funding.
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
            <div className="glass-subtle rounded-2xl p-3">
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
            <div className="glass-subtle rounded-2xl p-3">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-muted text-sm">
                  {walletAction === 'deposit' ? 'Deposit amount, then card form opens' : 'Withdraw amount'}
                </span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-2">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    max="500"
                    value={walletAction === 'deposit' ? depositAmount : withdrawAmount}
                    onChange={(e) => walletAction === 'deposit' ? setDepositAmount(e.target.value) : setWithdrawAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-7 pr-3 py-2.5 bg-white border border-gray-200 text-foreground placeholder:text-muted-2 rounded-xl text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
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
                  className="w-full sm:w-auto px-3 py-2.5 text-muted hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {transactions.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <h3 className="text-sm text-muted-2 mb-2">Recent Transactions</h3>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {transactions.slice(0, 5).map((tx: any) => (
                  <div key={tx.id} className="flex justify-between items-center text-sm">
                    <span className="text-muted truncate mr-2">{tx.description || tx.type}</span>
                    <span className={`font-semibold whitespace-nowrap tabular-nums ${tx.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {tx.amount > 0 ? '+' : ''}${Math.abs(tx.amount).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Notifications Card */}
        <div className="glass rounded-3xl p-4 sm:p-6 mt-6">
          <h2 className="font-display text-xl font-semibold text-foreground mb-4">Notifications</h2>

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
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-gray-200">
                <div>
                  <p className="text-foreground font-medium">Push notifications</p>
                  <p className="text-sm text-muted-2">Master switch for all push notifications</p>
                </div>
                <ToggleSwitch
                  checked={notifPrefs.push_enabled}
                  onChange={handleToggleMasterNotifications}
                  disabled={notifSavingKeys.has('push_enabled')}
                  label="Push notifications"
                />
              </div>

              <div className="mt-4 space-y-3">
                {NOTIFICATION_CATEGORY_OPTIONS.map(({ key, label }) => (
                  <div
                    key={key}
                    className={`flex items-center justify-between gap-4 ${
                      !notifPrefs.push_enabled ? 'opacity-50' : ''
                    }`}
                  >
                    <span className="text-sm text-foreground">{label}</span>
                    <ToggleSwitch
                      checked={!!notifPrefs.categories?.[key]}
                      onChange={() => handleToggleCategory(key)}
                      disabled={!notifPrefs.push_enabled || notifSavingKeys.has(key)}
                      label={label}
                    />
                  </div>
                ))}
              </div>

              {notifError && (
                <p className="text-red-600 text-sm mt-3">{notifError}</p>
              )}

              <div className="mt-5 pt-4 border-t border-gray-200">
                {deviceEnabled ? (
                  <p className="text-sm text-muted-2">Notifications are enabled on this device.</p>
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

        {/* Stats Card */}
        <div className="mt-6">
          <h2 className="font-display text-xl font-semibold text-foreground mb-4">Your Stats</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <div className="glass-subtle rounded-3xl p-4 sm:p-5">
              <div className="text-xs sm:text-sm text-muted-2 mb-1">Total Bet</div>
              <div className="text-2xl sm:text-3xl font-display font-semibold text-sky-600 break-words tabular-nums">
                ${userData.total_bet?.toFixed(2) || '0.00'}
              </div>
            </div>
            <div className="glass-subtle rounded-3xl p-4 sm:p-5">
              <div className="text-xs sm:text-sm text-muted-2 mb-1">Net Total</div>
              <div
                className={`text-2xl sm:text-3xl font-display font-semibold break-words tabular-nums ${
                  userData.net_total > 0
                    ? 'text-green-600'
                    : userData.net_total < 0
                    ? 'text-red-600'
                    : 'text-muted'
                }`}
              >
                {userData.net_total > 0 ? '+' : ''}${userData.net_total?.toFixed(2) || '0.00'}
              </div>
            </div>
            <div className="glass-subtle rounded-3xl p-4 sm:p-5">
              <div className="text-xs sm:text-sm text-muted-2 mb-1">Win Streak</div>
              <div className="text-2xl sm:text-3xl font-display font-semibold text-amber-600 tabular-nums">
                🔥 {userData.streak || 0}
              </div>
            </div>
          </div>
        </div>

        {/* Account Info */}
        <div className="glass rounded-3xl p-4 sm:p-6 mt-6">
          <h2 className="font-display text-xl font-semibold text-foreground mb-4">Account Info</h2>
          <div className="space-y-3">
            <div>
              <div className="text-sm text-muted-2">Email</div>
              <div className="text-foreground break-words">{user.primaryEmail}</div>
            </div>
            <div>
              <div className="text-sm text-muted-2">User ID</div>
              <div className="text-muted text-xs sm:text-sm font-mono break-all">{user.id}</div>
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
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-pressed={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-blue-600' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
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
