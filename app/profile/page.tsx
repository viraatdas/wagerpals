
'use client';
export const dynamic = 'force-dynamic';


import { useEffect, useState } from 'react';
import { useUser } from '@stackframe/stack';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Toast, { ToastType } from '@/components/Toast';
import { validateUsername } from '@/lib/utils';
import { subscribeToWebPush } from '@/components/PushNotificationPrompt';
import WalletPanel from '@/components/WalletPanel';

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
        setNotifError("Couldn't save that. Try again.");
      }
    } catch (error) {
      setNotifPrefs(previous);
      setNotifError("Couldn't save that. Try again.");
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
        setNotifError("Couldn't save that. Try again.");
      }
    } catch (error) {
      setNotifPrefs(previous);
      setNotifError("Couldn't save that. Try again.");
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
        setToast({ message: 'Username saved.', type: 'success' });
      } else {
        const data = await response.json();
        setError(data.error || "Couldn't save that username. Try again.");
      }
    } catch (error: any) {
      setError("Couldn't save that username. Try again.");
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
              <div className="flex h-16 w-16 sm:h-20 sm:w-20 flex-none items-center justify-center rounded-pill bg-amber/15 border-2 border-amber text-2xl sm:text-3xl font-display font-bold text-amber-ink">
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
                className={`font-mono text-4xl sm:text-5xl ${
                  userData.net_total > 0 ? 'text-emerald' : userData.net_total < 0 ? 'text-crimson-ink' : 'text-ink-muted'
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
              <p className="eyebrow mb-2">Total wagered</p>
              <p className="font-mono text-2xl text-ink break-words">${userData.total_bet?.toFixed(2) || '0.00'}</p>
            </div>
            <div className="card p-4 sm:p-5">
              <p className="eyebrow mb-2">Net total</p>
              <p
                className={`font-mono text-2xl break-words ${
                  userData.net_total > 0 ? 'text-emerald' : userData.net_total < 0 ? 'text-crimson-ink' : 'text-ink-muted'
                }`}
              >
                {userData.net_total > 0 ? '+' : userData.net_total < 0 ? '-' : ''}$
                {Math.abs(userData.net_total || 0).toFixed(2)}
              </p>
            </div>
            <div className="card p-4 sm:p-5">
              <p className="eyebrow mb-2">Win streak</p>
              <p className={`font-mono text-2xl ${userData.streak > 0 ? 'text-emerald' : 'text-ink'}`}>
                {userData.streak || 0}
              </p>
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
                  Change username
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
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Wallet — shared with /wallet (components/WalletPanel.tsx). Keeps
            the old /profile?wallet=deposit#wallet deep link working: the
            panel owns the id="wallet" anchor and reads the query param
            itself. See IA-DECISIONS.md #2. */}
        <div className="mb-8">
          <div className="section-head mb-4">
            <span className="eyebrow">Wallet</span>
          </div>
          <WalletPanel />
        </div>

        {/* Friends — reachable from here on mobile, where the bottom tab
            bar only has room for Board/Live/History/Profile (see
            IA-DECISIONS.md #5). */}
        <div className="mb-8">
          <Link
            href="/users"
            className="card card-interactive flex items-center justify-between gap-3 p-4 sm:p-5"
          >
            <div>
              <p className="font-sans font-semibold text-ink">Friends</p>
              <p className="field-hint mt-0.5">Records, streaks, and who&apos;s up</p>
            </div>
            <svg className="w-5 h-5 text-ink-muted flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
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
              <p className="text-sm text-ink-muted">Couldn&apos;t load your notification settings. Try again.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 pb-4 border-b border-line">
                  <div>
                    <p id="notif-master-label" className="text-sm font-medium text-ink">
                      Push notifications
                    </p>
                    <p className="field-hint mt-0.5">
                      Master switch: turning this off disables every push notification below.
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
                        <p id={`notif-${key}-label`} className="text-sm text-ink">
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

                <div className="mt-5 pt-4 border-t border-line">
                  {deviceEnabled ? (
                    <p className="text-sm text-ink-muted">Notifications are enabled on this device.</p>
                  ) : (
                    <button
                      onClick={handleEnableOnDevice}
                      disabled={deviceEnabling}
                      className="btn-glass text-sm px-4 py-2 disabled:opacity-50"
                    >
                      {deviceEnabling ? 'Enabling…' : 'Enable on this device'}
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
              <p className="text-ink break-words">{user.primaryEmail}</p>
            </div>
            <div>
              <p className="eyebrow mb-1">User ID</p>
              <p className="text-ink-muted text-xs sm:text-sm font-mono break-all">{user.id}</p>
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
        checked ? 'bg-accent' : 'bg-surface-elevated'
      }`}
    >
      <span
        className={`inline-flex h-4 w-4 transform items-center justify-center rounded-full bg-ink shadow-elev-1 transition-transform ${
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

