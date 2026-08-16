// Notification preferences screen — mirrors the seven server-side categories
// in lib/types.ts (bets/comments/mentions/resolutions/invites/group_activity/
// payments) plus the push_enabled/email_enabled master switches from
// app/api/push/preferences/route.ts.
//
// Saving is optimistic (the toggle flips immediately) and every rapid toggle
// is coalesced into a single debounced PATCH — see `scheduleFlush`/
// `flushPending` below — instead of firing one request per tap. A failed
// PATCH rolls the UI back to the last server-confirmed state (reapplying any
// edits made after the failed one, so a fast second toggle isn't lost).
//
// OS permission reality check: `notificationService.getPermissionStatus()`
// (mobile/src/services/notifications.ts) only reflects whatever the *last*
// permission request/init cycle observed, which can go stale the moment the
// user leaves for iOS Settings and comes back. Rather than invent a new
// service API, this screen reads the same underlying `expo-notifications`
// permission query directly (`Notifications.getPermissionsAsync()` — a
// read-only call, it never prompts) on mount and whenever the app returns to
// the foreground, so the banner below reflects the real, current OS state.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { Button, Card, ErrorState, SectionHeader, Skeleton, Toggle } from '../components';
import apiService from '../services/api';
import * as haptics from '../utils/haptics';
import { ApiError, toApiError } from '../utils/errors';
import { colors, radius, spacing, tokens } from '../theme';
import type { NotificationCategories, NotificationCategory, NotificationPreferences } from '../types';

type OsPermission = 'granted' | 'denied' | 'undetermined' | null;

type PendingPatch = {
  push_enabled?: boolean;
  email_enabled?: boolean;
  categories?: Partial<NotificationCategories>;
};

const DEBOUNCE_MS = 500;

const CATEGORY_META: { key: NotificationCategory; label: string; description: string }[] = [
  { key: 'bets', label: 'Bets', description: "When someone places a bet on an event you're in" },
  { key: 'comments', label: 'Comments', description: 'Replies and new comments on your events' },
  { key: 'mentions', label: 'Mentions', description: 'When someone mentions you' },
  { key: 'resolutions', label: 'Resolutions', description: 'When an event you bet on is settled' },
  { key: 'invites', label: 'Invites', description: 'Group invitations and join requests' },
  { key: 'group_activity', label: 'Group activity', description: 'New events and members in your groups' },
  { key: 'payments', label: 'Payments', description: 'Deposits, withdrawals and payouts' },
];

function mergePatchInto(prev: PendingPatch, next: PendingPatch): PendingPatch {
  return {
    ...prev,
    ...(next.push_enabled !== undefined ? { push_enabled: next.push_enabled } : {}),
    ...(next.email_enabled !== undefined ? { email_enabled: next.email_enabled } : {}),
    ...(next.categories ? { categories: { ...prev.categories, ...next.categories } } : {}),
  };
}

function applyPatch(base: NotificationPreferences, patch: PendingPatch): NotificationPreferences {
  return {
    ...base,
    ...(patch.push_enabled !== undefined ? { push_enabled: patch.push_enabled } : {}),
    ...(patch.email_enabled !== undefined ? { email_enabled: patch.email_enabled } : {}),
    categories: patch.categories ? { ...base.categories, ...patch.categories } : base.categories,
  };
}

export default function NotificationPreferencesScreen() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [osPermission, setOsPermission] = useState<OsPermission>(null);

  const basePrefsRef = useRef<NotificationPreferences | null>(null);
  const pendingPatchRef = useRef<PendingPatch>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await apiService.getNotificationPreferences();
      if (!mountedRef.current) return;
      basePrefsRef.current = data;
      const pending = pendingPatchRef.current;
      setPrefs(Object.keys(pending).length ? applyPatch(data, pending) : data);
    } catch (err) {
      if (!mountedRef.current) return;
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/push/preferences');
      setLoadError(apiErr.userMessage);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const checkOsPermission = useCallback(async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (mountedRef.current) setOsPermission(status as OsPermission);
    } catch {
      // Can't determine OS permission state — the banner just stays hidden
      // rather than showing something we can't back up.
    }
  }, []);

  useEffect(() => {
    checkOsPermission();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkOsPermission();
    });
    return () => sub.remove();
  }, [checkOsPermission]);

  function scheduleFlush() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushPending();
    }, DEBOUNCE_MS);
  }

  async function flushPending() {
    if (inFlightRef.current) return;
    const patch = pendingPatchRef.current;
    if (Object.keys(patch).length === 0) return;

    pendingPatchRef.current = {};
    inFlightRef.current = true;
    setIsSyncing(true);
    try {
      const updated = await apiService.updateNotificationPreferences(patch);
      if (!mountedRef.current) return;
      basePrefsRef.current = updated;
      setSaveError(null);
      const stillPending = pendingPatchRef.current;
      setPrefs(Object.keys(stillPending).length ? applyPatch(updated, stillPending) : updated);
    } catch (err) {
      if (!mountedRef.current) return;
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/push/preferences');
      setSaveError(apiErr.userMessage);
      haptics.error();
      // Roll back to the last server-confirmed state, but re-apply anything
      // the user changed *after* this failed patch was sent — those edits
      // are still queued in pendingPatchRef and must not be discarded.
      if (basePrefsRef.current) {
        setPrefs(applyPatch(basePrefsRef.current, pendingPatchRef.current));
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setIsSyncing(false);
      if (Object.keys(pendingPatchRef.current).length > 0) {
        scheduleFlush();
      }
    }
  }

  function applyLocalChange(patch: PendingPatch) {
    setPrefs((prev) => (prev ? applyPatch(prev, patch) : prev));
    setSaveError(null);
    pendingPatchRef.current = mergePatchInto(pendingPatchRef.current, patch);
    scheduleFlush();
  }

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const showPermissionBanner = !!prefs?.push_enabled && osPermission === 'denied';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {loading ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <SkeletonSection rows={2} />
          <View style={{ height: spacing.xl }} />
          <SkeletonSection rows={7} />
        </ScrollView>
      ) : !prefs ? (
        <ErrorState
          message={loadError || 'Unable to load notification preferences.'}
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.brand} />}
        >
          {showPermissionBanner ? (
            <Card style={styles.banner} padded>
              <View style={styles.bannerRow}>
                <View style={styles.bannerIconChip}>
                  <Ionicons name="notifications-off-outline" size={20} color={colors.amber} />
                </View>
                <View style={styles.bannerTextWrap}>
                  <Text style={styles.bannerTitle}>Notifications are off in iOS Settings</Text>
                  <Text style={styles.bannerMessage} numberOfLines={3}>
                    Push is turned on here, but iOS won't deliver anything until you allow
                    notifications for WagerPals in Settings.
                  </Text>
                </View>
              </View>
              <Button
                title="Open Settings"
                onPress={() => {
                  Linking.openSettings().catch(() => {});
                }}
                variant="secondary"
                size="sm"
                style={styles.bannerButton}
              />
            </Card>
          ) : null}

          <SectionHeader title="Notifications" subtitle="Choose what WagerPals can reach you about" />
          <Card>
            <Toggle
              label="Push notifications"
              description="Master switch for all push notifications"
              value={prefs.push_enabled}
              onValueChange={(v) => applyLocalChange({ push_enabled: v })}
            />
            <View style={styles.divider} />
            <Toggle
              label="Email"
              description="Email summaries and important account updates"
              value={prefs.email_enabled}
              onValueChange={(v) => applyLocalChange({ email_enabled: v })}
            />
          </Card>

          <View style={{ height: spacing.xl }} />

          <SectionHeader
            title="Categories"
            subtitle={prefs.push_enabled ? undefined : 'Turn on push notifications to enable these'}
          />
          <Card>
            {CATEGORY_META.map((cat, i) => (
              <React.Fragment key={cat.key}>
                <Toggle
                  label={cat.label}
                  description={cat.description}
                  value={!!prefs.categories?.[cat.key]}
                  disabled={!prefs.push_enabled}
                  onValueChange={(v) => applyLocalChange({ categories: { [cat.key]: v } })}
                />
                {i < CATEGORY_META.length - 1 ? <View style={styles.divider} /> : null}
              </React.Fragment>
            ))}
          </Card>

          <View style={styles.footer}>
            {saveError ? (
              <View style={styles.footerRow}>
                <Ionicons name="alert-circle" size={14} color={colors.rose} />
                <Text style={styles.errorText}>{saveError}</Text>
              </View>
            ) : isSyncing ? (
              <Text style={styles.syncingText}>Saving…</Text>
            ) : null}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SkeletonSection({ rows }: { rows: number }) {
  return (
    <Card>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <View style={styles.skeletonTextCol}>
            <Skeleton width="55%" height={16} style={{ marginBottom: spacing.xs }} />
            <Skeleton width="80%" height={12} />
          </View>
          <Skeleton width={44} height={26} radius={13} />
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg2,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  banner: {
    marginBottom: spacing.xl,
    borderColor: colors.amber,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  bannerIconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.amberFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  bannerTitle: {
    fontSize: tokens.fontSize.sm,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs / 2,
  },
  bannerMessage: {
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
    lineHeight: tokens.lineHeight.sm,
  },
  bannerButton: {
    alignSelf: 'flex-start',
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  skeletonTextCol: {
    flex: 1,
    minWidth: 0,
  },
  footer: {
    marginTop: spacing.lg,
    minHeight: 20,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  errorText: {
    flexShrink: 1,
    fontSize: tokens.fontSize.xs,
    color: colors.rose,
  },
  syncingText: {
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
  },
});
