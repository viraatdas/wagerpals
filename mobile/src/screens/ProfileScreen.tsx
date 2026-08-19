// Profile screen — avatar/stats header, wallet summary (audit finding D12:
// there was previously no way to see a balance or add funds from the
// phone), and account settings.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, StatusBar, ScrollView, RefreshControl, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import notificationService from '../services/notifications';
import { User, WalletSummary } from '../types';
import { ApiError, toApiError } from '../utils/errors';
import { truncate, formatMoney } from '../utils/format';
import { success, error as hapticError } from '../utils/haptics';
import { colors, font, radius, spacing, tokens } from '../theme';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Money,
  WAmount,
  Pill,
  SectionHeader,
  SkeletonCard,
  SkeletonList,
} from '../components';

// Matches the tab bar's own height (see navigation/MainTabNavigator.tsx) —
// the bar is absolutely positioned so scroll content needs explicit bottom
// clearance or the last row ends up hidden behind it.
const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 88 : 64;

type IconChipTone = 'brand' | 'amber' | 'info' | 'rose';

const ICON_CHIP_TONE: Record<IconChipTone, { bg: string; fg: string }> = {
  brand: { bg: colors.brandFill, fg: colors.brand },
  amber: { bg: colors.amberFill, fg: colors.amber },
  info: { bg: colors.cyanFill, fg: colors.cyan },
  rose: { bg: colors.roseFill, fg: colors.rose },
};

// `Money` (the shared component) doesn't itself guard against a non-finite
// input — it just does `Math.abs(amount).toFixed(2)`, which prints "$NaN"
// for a NaN. Every value handed to it here goes through this first so a bad
// server value can never render as "$NaN" or crash mid-format.
function safeAmount(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function IconChip({ name, tone }: { name: keyof typeof Ionicons.glyphMap; tone: IconChipTone }) {
  const { bg, fg } = ICON_CHIP_TONE[tone];
  return (
    <View style={[styles.iconChip, { backgroundColor: bg }]}>
      <Ionicons name={name} size={18} color={fg} />
    </View>
  );
}

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { user: authUser, isLoading: authLoading, signOut } = useAuth();
  const insets = useSafeAreaInsets();

  const [userData, setUserData] = useState<User | null>(null);
  const [walletSummary, setWalletSummary] = useState<WalletSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [walletError, setWalletError] = useState<ApiError | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Guards against setState-after-unmount from a fetch that resolves after
  // the screen has gone away.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // True once the first load (success or failure) has completed — used so a
  // silent background refetch-on-focus doesn't flash the skeleton again.
  const hasLoadedRef = useRef(false);

  const loadUserData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!authUser) {
      // AUDIT FINDING D8 (the bug this screen shipped with): the old code
      // was `if (!authUser) return;` sitting BEFORE the try/finally below,
      // so it skipped the `finally` that cleared isLoading — if auth was
      // momentarily null (which it legitimately is for an instant on every
      // cold start while Stack Auth resolves), the screen showed a spinner
      // FOREVER. Every path through this function — including "no user" —
      // must reach a point that clears isLoading/isRefreshing.
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
      return;
    }

    if (!opts?.silent) {
      setLoadError(null);
      setWalletError(null);
    }

    // User profile and wallet summary are independent of one another — a
    // wallet hiccup must not block the rest of the profile from rendering,
    // and vice versa, so each leg is caught on its own instead of one
    // Promise.all rejection wiping out both.
    const [userResult, walletResult] = await Promise.allSettled([
      apiService.getUser(authUser.id),
      apiService.getWallet(authUser.id),
    ]);

    if (!mountedRef.current) return;

    if (userResult.status === 'fulfilled') {
      setUserData(userResult.value);
      setLoadError(null);
    } else {
      setLoadError(userResult.reason instanceof ApiError ? userResult.reason : toApiError(userResult.reason, '/api/users'));
    }

    if (walletResult.status === 'fulfilled') {
      setWalletSummary(walletResult.value);
      setWalletError(null);
    } else {
      setWalletError(walletResult.reason instanceof ApiError ? walletResult.reason : toApiError(walletResult.reason, '/api/wallet'));
    }

    setIsLoading(false);
    setIsRefreshing(false);
  }, [authUser]);

  // Refetch on every focus (e.g. coming back from the Wallet screen after a
  // deposit/withdrawal) but only show the full-screen skeleton on the very
  // first load — later focuses refresh silently.
  useFocusEffect(
    useCallback(() => {
      if (authLoading) return;
      loadUserData({ silent: hasLoadedRef.current });
      hasLoadedRef.current = true;
    }, [authLoading, loadUserData])
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    // See apiService.invalidateForRefresh.
    apiService.invalidateForRefresh('/api/users', '/api/wallet');
    loadUserData({ silent: true });
  }, [loadUserData]);

  const handleSignOut = useCallback(() => {
    if (isSigningOut) return;
    Alert.alert(
      'Sign out?',
      "You'll need to sign in again to place bets.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setIsSigningOut(true);
            try {
              await signOut();
              success();
            } catch (err) {
              hapticError();
              const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/auth');
              Alert.alert('Error', apiErr.userMessage);
            } finally {
              // The api layer's GET cache is keyed by URL only, NOT by
              // user — without this, the next person to sign in on this
              // device could briefly see this user's cached groups/wallet/
              // activity before their own requests land. Clearing runs in
              // `finally` so it happens even if signOut() itself errored
              // partway through.
              apiService.clearCache();
              if (mountedRef.current) setIsSigningOut(false);
            }
          },
        },
      ]
    );
  }, [signOut, isSigningOut]);

  const handleTestNotification = useCallback(async () => {
    if (!authUser?.id) return;
    try {
      await notificationService.init(authUser.id);
      await apiService.sendPushToUser({
        userId: authUser.id,
        title: 'Test Notification',
        body: 'Push notifications are working!',
      });
      success();
      Alert.alert('Sent', 'Push notifications are working.');
    } catch (err) {
      hapticError();
      const message =
        err instanceof ApiError ? err.userMessage : "Failed to send test notification. Make sure you're on a physical device.";
      Alert.alert('Error', message);
    }
  }, [authUser]);

  const goToWallet = useCallback(() => {
    navigation.navigate('Wallet');
  }, [navigation]);

  if (authLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
        <LoadingState style={styles.stateFill} />
      </SafeAreaView>
    );
  }

  // Proper signed-out state instead of a spinner (part of the D8 fix) — a
  // null authUser is an expected, renderable state, not a loading state.
  if (!authUser) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
        <EmptyState
          icon="log-in-outline"
          title="Sign in required"
          message="Sign in to see your profile, stats, and wallet."
          style={styles.stateFill}
        />
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.skeletonHeader}>
            <SkeletonCard />
          </View>
          <SkeletonCard />
          <View style={styles.skeletonGap}>
            <SkeletonList count={3} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (loadError && !userData) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
        <ErrorState message={loadError.userMessage} onRetry={() => loadUserData()} style={styles.stateFill} />
      </SafeAreaView>
    );
  }

  const netTotal = safeAmount(userData?.net_total);
  const totalBet = safeAmount(userData?.total_bet);
  const streak = Number.isFinite(userData?.streak) ? userData!.streak : 0;
  const displayUsername = truncate(userData?.username ?? '', 20);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + spacing.xl }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.brand2} />}
      >
        {/* Profile header */}
        <View style={styles.profileHeader}>
          <Avatar username={userData?.username} size="lg" style={styles.avatar} />
          <Text style={styles.username} numberOfLines={1} ellipsizeMode="tail">
            @{displayUsername}
          </Text>
          {authUser?.email ? (
            <Text style={styles.email} numberOfLines={1} ellipsizeMode="tail">
              {authUser.email}
            </Text>
          ) : null}
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <Text style={styles.statLabel} numberOfLines={1}>Net total</Text>
            <Money amount={netTotal} tone="auto" signed size="md" />
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statLabel} numberOfLines={1}>Total bet</Text>
            <Money amount={totalBet} tone="neutral" size="md" />
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statLabel} numberOfLines={1}>Win streak</Text>
            <Text
              style={[styles.streakValue, streak > 0 && styles.streakValuePositive]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {streak}
            </Text>
          </Card>
        </View>

        {/* Wallet summary — audit finding D12 fix: this card + the Wallet
            screen are the only place a balance can be seen or funded from
            the phone. */}
        <SectionHeader title="Wallet" />
        {walletSummary ? (
          <Card elevated style={styles.walletCard}>
            <View style={styles.walletStatsRow}>
              <View style={styles.walletStatCol}>
                <Text style={styles.walletLabel}>Available</Text>
                <Money amount={safeAmount(walletSummary.available)} tone="neutral" size="lg" />
              </View>
              <View style={styles.walletStatColRight}>
                <Text style={styles.walletLabel}>Escrowed</Text>
                <Pill
                  label={formatMoney(walletSummary.escrow_held_total)}
                  tone="pending"
                  icon="lock-closed-outline"
                />
              </View>
            </View>
            {/* W is a separate ledger from cash — its own row, not folded
                into the $ balance above. */}
            <View style={styles.wRow}>
              <Text style={styles.walletLabel}>W balance</Text>
              <WAmount value={safeAmount(walletSummary.wallet.wp_balance)} tone="neutral" size="md" />
            </View>
            <Button
              title="Add funds"
              onPress={goToWallet}
              variant="primary"
              size="md"
              icon="add-circle-outline"
              fullWidth
              style={styles.addFundsButton}
            />
            <ListRow
              title="View wallet"
              subtitle="Balance, deposits, and transaction history"
              leading={<IconChip name="wallet-outline" tone="brand" />}
              onPress={goToWallet}
              showChevron
              style={styles.viewWalletRow}
            />
          </Card>
        ) : walletError ? (
          <Card style={styles.walletCard}>
            <ErrorState
              message={walletError.userMessage}
              onRetry={() => loadUserData()}
              compact
            />
          </Card>
        ) : (
          <SkeletonCard />
        )}

        {/* Settings */}
        <View style={styles.settingsHeader}>
          <SectionHeader title="Settings" />
        </View>
        <Card padded style={styles.menuCard}>
          <ListRow
            title="Edit Username"
            leading={<IconChip name="create-outline" tone="brand" />}
            onPress={() => navigation.navigate('EditUsername')}
            showChevron
          />
          <ListRow
            title="Notification Preferences"
            leading={<IconChip name="notifications-outline" tone="amber" />}
            onPress={() => navigation.navigate('NotificationPreferences')}
            showChevron
          />
          <ListRow
            title="Test Notification"
            leading={<IconChip name="paper-plane-outline" tone="info" />}
            onPress={handleTestNotification}
            showChevron
          />
        </Card>
        <Card padded style={styles.menuCard}>
          <ListRow
            title="Sign Out"
            leading={<IconChip name="log-out-outline" tone="rose" />}
            onPress={handleSignOut}
            destructive
            showChevron
            accessibilityLabel="Sign out"
          />
        </Card>

        {loadError && userData ? (
          <Text style={styles.staleNotice}>Some data may be out of date — pull to refresh.</Text>
        ) : null}

        <Text style={styles.versionText}>WagerPals v1.0.1</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  stateFill: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  skeletonHeader: {
    marginBottom: spacing.lg,
  },
  skeletonGap: {
    marginTop: spacing.lg,
  },
  profileHeader: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  avatar: {
    marginBottom: spacing.lg,
  },
  username: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize['2xl'],
    color: colors.text,
    marginBottom: 4,
    maxWidth: '90%',
  },
  email: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    maxWidth: '90%',
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  statLabel: {
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  streakValue: {
    fontFamily: font.monoMedium,
    fontSize: tokens.fontSize.base,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  streakValuePositive: {
    color: tokens.color.win,
  },
  walletCard: {
    marginBottom: spacing.xl,
  },
  walletStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  walletStatCol: {
    flexShrink: 1,
    minWidth: 0,
  },
  walletStatColRight: {
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  walletLabel: {
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  wRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    marginBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  addFundsButton: {
    marginBottom: spacing.sm,
  },
  viewWalletRow: {
    marginBottom: -spacing.sm,
  },
  settingsHeader: {
    marginTop: spacing.xs,
  },
  menuCard: {
    marginBottom: spacing.md,
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  staleNotice: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  versionText: {
    fontFamily: font.mono,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
});
