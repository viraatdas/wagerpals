// Wallet screen — audit finding D12: before this screen existed there was
// NO way to see a balance or fund a wallet from the phone, which made every
// paid bet on iOS fail with "insufficient balance" and no remedy. This is
// the remedy: balance + escrow, deposit/withdraw, and transaction history.
//
// Pushed from ProfileScreen onto the root stack, which supplies its own
// native header (title/back button) — this screen only renders the content
// below that header, matching GroupDetailScreen/EventDetailScreen.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ListRenderItemInfo,
  RefreshControl,
  Alert,
  Linking,
  AppState,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { Transaction, WalletSummary } from '../types';
import { ApiError, toApiError } from '../utils/errors';
import { formatMoney, formatW, formatRelativeTime } from '../utils/format';
import { generateId } from '../utils/helpers';
import { success, error as hapticError, tapMedium } from '../utils/haptics';
import { colors, spacing, tokens } from '../theme';
import {
  AmountInput,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  WAmount,
  Pill,
  SectionHeader,
  SkeletonCard,
  SkeletonList,
} from '../components';

// Matches the tab bar's own height (see navigation/MainTabNavigator.tsx).
// Wallet is a pushed (non-tab) screen, but its scroll content still ends up
// behind the tab bar when the user swipes back to Profile mid-scroll on some
// devices, so the same clearance is applied for consistency with every other
// scroll screen in the app.
const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 88 : 64;

// Mirrors lib/payments.ts's MAX_TRANSACTION_AMOUNT exactly. Kept as a literal
// (not imported) because mobile can't import server-side code — if the
// server constant changes, this must change with it in the same commit.
const MAX_TRANSACTION_AMOUNT = 500;

const QUICK_DEPOSIT_AMOUNTS = [25, 50, 100, 250];
const QUICK_WITHDRAW_AMOUNTS = [25, 50, 100];

// Escrow/pending money states stay out of the amber "people" palette — see
// components/Ledger.tsx's HOLD_CHIPS comment and the escrow chip on
// EventDetailScreen: amber never touches a money value. "gold" is the one
// color that's exclusively won-money (winnings/payout), deliberately
// distinct from amber so it never gets confused with the people accent.
type TxIconTone = 'yes' | 'no' | 'gold' | 'info' | 'neutral';

const TX_TONE_COLOR: Record<TxIconTone, { bg: string; fg: string }> = {
  yes: { bg: colors.mintFill, fg: colors.mint },
  no: { bg: colors.roseFill, fg: colors.rose },
  gold: { bg: tokens.color.goldFill, fg: tokens.color.gold },
  info: { bg: colors.cyanFill, fg: colors.cyan },
  neutral: { bg: colors.bg2, fg: colors.textFaint },
};

const TX_ICON: Record<Transaction['type'], { name: keyof typeof Ionicons.glyphMap; tone: TxIconTone }> = {
  deposit: { name: 'arrow-down-circle-outline', tone: 'yes' },
  withdrawal: { name: 'arrow-up-circle-outline', tone: 'no' },
  bet_placed: { name: 'lock-closed-outline', tone: 'info' },
  escrow_hold: { name: 'lock-closed-outline', tone: 'info' },
  bet_refund: { name: 'return-up-back-outline', tone: 'info' },
  escrow_release: { name: 'return-up-back-outline', tone: 'info' },
  refund: { name: 'return-up-back-outline', tone: 'info' },
  winnings: { name: 'trophy-outline', tone: 'gold' },
  payout: { name: 'trophy-outline', tone: 'gold' },
};

// Mirrors components/Ledger.tsx's TRANSACTION_LABELS on the web so the same
// transaction reads the same way in both places.
const TX_LABEL: Partial<Record<Transaction['type'], string>> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  bet_placed: 'Bet placed',
  bet_refund: 'Bet refunded',
  winnings: 'Winnings',
  escrow_hold: 'Stake escrowed',
  escrow_release: 'Stake returned',
  payout: 'Winnings',
  refund: 'Refunded',
};

function getTxLabel(t: Transaction): string {
  return t.description || TX_LABEL[t.type] || t.type.replace(/_/g, ' ');
}

// `Money` (the shared component) doesn't itself guard against a non-finite
// input — it just does `Math.abs(amount).toFixed(2)`, which prints "$NaN"
// for a NaN. Every value handed to it in this screen goes through this
// first so a bad server value can never render as "$NaN" or crash mid-format.
function safeAmount(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

const TransactionRow = React.memo(function TransactionRow({ item }: { item: Transaction }) {
  const icon = TX_ICON[item.type] ?? { name: 'ellipse-outline' as const, tone: 'neutral' as const };
  const toneColor = TX_TONE_COLOR[icon.tone];
  const label = getTxLabel(item);
  // Won money reads Gold, not the usual Emerald-for-positive — gold is
  // reserved for money that's actually been WON (see MOBILE-SPEC.md).
  const isWonMoney = item.type === 'winnings' || item.type === 'payout';
  // created_at is optional on the type — a transaction missing it (should
  // never happen server-side, but nothing here should crash if it does)
  // just omits the relative-time line instead of rendering "Invalid Date".
  const createdAtMs = item.created_at ? new Date(item.created_at).getTime() : NaN;
  const timeLabel = Number.isFinite(createdAtMs) ? formatRelativeTime(createdAtMs) : null;

  return (
    <Card style={styles.txCard}>
      <View style={styles.txRow}>
        <View style={[styles.txIconChip, { backgroundColor: toneColor.bg }]}>
          <Ionicons name={icon.name} size={18} color={toneColor.fg} />
        </View>
        <View style={styles.txTextCol}>
          <Text style={styles.txLabel} numberOfLines={1} ellipsizeMode="tail">
            {label}
          </Text>
          <View style={styles.txMetaRow}>
            {timeLabel ? (
              <Text style={styles.txTime} numberOfLines={1}>
                {timeLabel}
              </Text>
            ) : null}
            {item.status !== 'completed' ? (
              // A transaction still in flight is a money STATE, not a
              // person — quiet neutral (info), never amber. Only a genuine
              // failure gets the crimson "no" tone.
              <Pill
                label={item.status === 'pending' ? 'Pending' : 'Failed'}
                tone={item.status === 'pending' ? 'info' : 'no'}
                size="sm"
              />
            ) : null}
          </View>
        </View>
        {item.currency === 'wp' ? (
          <WAmount
            value={safeAmount(item.amount)}
            tone={isWonMoney ? 'neutral' : 'auto'}
            signed
            size="md"
            color={isWonMoney ? tokens.color.gold : undefined}
            style={styles.txAmount}
          />
        ) : (
          <Money
            amount={safeAmount(item.amount)}
            tone={isWonMoney ? 'neutral' : 'auto'}
            signed
            size="md"
            style={[styles.txAmount, isWonMoney && styles.goldAmount]}
          />
        )}
      </View>
    </Card>
  );
});

export default function WalletScreen() {
  const { user, isLoading: authLoading } = useAuth();
  const insets = useSafeAreaInsets();

  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  const [activeSheet, setActiveSheet] = useState<'deposit' | 'withdraw' | null>(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | undefined>(undefined);
  const [depositHandoffPending, setDepositHandoffPending] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const hasLoadedRef = useRef(false);

  // One idempotency key per withdrawal ATTEMPT: generated the moment the
  // sheet opens fresh, reused across retries of that same attempt (e.g. the
  // user taps "Withdraw" again after a timeout without closing the sheet),
  // and cleared so the NEXT open (or the next successful submit) gets a new
  // key. This is what stops a double-tap or a retry-after-timeout from
  // creating two withdrawals — the server's withdrawFromWallet treats a
  // repeated key as a no-op replay (see lib/payments.ts, `duplicate: true`).
  const withdrawIdemKeyRef = useRef<string | null>(null);

  const loadWallet = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user) {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
      return;
    }

    if (!opts?.silent) {
      setLoadError(null);
    }

    try {
      const data = await apiService.getWallet(user.id);
      if (!mountedRef.current) return;
      setSummary(data);
      setLoadError(null);
      setDepositHandoffPending(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setLoadError(err instanceof ApiError ? err : toApiError(err, '/api/wallet'));
    } finally {
      if (!mountedRef.current) return;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (authLoading) return;
      loadWallet({ silent: hasLoadedRef.current });
      hasLoadedRef.current = true;
    }, [authLoading, loadWallet])
  );

  // The deposit flow hands the user off to a browser (see
  // handleContinueDeposit below) — this is what notices they've come back
  // and refreshes the balance without them having to remember to
  // pull-to-refresh.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && hasLoadedRef.current) {
        loadWallet({ silent: true });
      }
    });
    return () => subscription.remove();
  }, [loadWallet]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    // See apiService.invalidateForRefresh. This screen is also where the
    // user lands after completing a deposit in the browser, so a stale
    // balance here reads as "my money vanished".
    apiService.invalidateForRefresh('/api/wallet');
    loadWallet({ silent: true });
  }, [loadWallet]);

  const openDeposit = useCallback(() => {
    setDepositAmount('');
    setActiveSheet('deposit');
  }, []);

  const openWithdraw = useCallback(() => {
    setWithdrawAmount('');
    setWithdrawError(undefined);
    withdrawIdemKeyRef.current = null;
    setActiveSheet('withdraw');
  }, []);

  const closeSheet = useCallback(() => {
    setActiveSheet(null);
  }, []);

  // ---- Deposit ---------------------------------------------------------
  //
  // HONEST CONSTRAINT, read before touching this: mobile/package.json has
  // NO Stripe SDK (`@stripe/stripe-react-native` is not installed, and we
  // were explicitly told not to add it as part of this change). POST
  // /api/wallet { action: 'deposit' } creates a real Stripe PaymentIntent
  // and returns a clientSecret — but *confirming* a PaymentIntent (taking a
  // card, running 3DS, etc.) requires the Stripe SDK's native payment UI,
  // which this app does not have. Calling apiService.createDeposit() here
  // just to discard the clientSecret would create a real, orphaned pending
  // Stripe PaymentIntent and a pending `transactions` row that this app can
  // never finish — worse than not calling it at all.
  //
  // So this screen does the honest thing instead of a fake one: it collects
  // and validates the amount in-app (cap, positive-number checks — the same
  // AmountInput used for withdraw), then hands off ENTIRELY to the existing,
  // working web deposit flow at `${API_BASE_URL}/profile?wallet=deposit`,
  // which creates and confirms its own PaymentIntent via
  // @stripe/react-stripe-js Elements (see app/profile/page.tsx). This is the
  // same hand-off URL EventDetailScreen/GroupDetailScreen already use for
  // their "insufficient balance -> add funds" prompts, so the behavior is
  // consistent app-wide, not a one-off. The AppState listener above refetches
  // the balance when the user returns to the app afterward.
  //
  // TODO(future node): to complete deposits fully in-app: add
  // `@stripe/stripe-react-native` to mobile/package.json, run an Expo
  // prebuild (it ships native modules, so this cannot be a pure JS/npm
  // install), wrap the app root in its `StripeProvider`, call
  // apiService.createDeposit() for the real clientSecret, and confirm it
  // with the SDK's PaymentSheet / confirmPayment. Do NOT try to fake this
  // with a WebView pointed at Stripe Checkout unless product/legal have
  // signed off — see the App Store note in this change's ship report:
  // Apple's guidelines have opinions about real-money cash-deposit flows in
  // iOS apps that are not resolved by this screen and need a human decision,
  // not an engineering one.
  const handleContinueDeposit = useCallback(() => {
    const amount = parseFloat(depositAmount);
    if (!depositAmount || !Number.isFinite(amount) || amount <= 0 || amount > MAX_TRANSACTION_AMOUNT) {
      return;
    }

    tapMedium();
    setActiveSheet(null);
    setDepositHandoffPending(true);

    const url = `${apiService.API_BASE_URL}/profile?wallet=deposit`;
    Linking.openURL(url).catch((err) => {
      hapticError();
      console.warn('[Wallet] failed to open deposit link:', err);
      setDepositHandoffPending(false);
      Alert.alert('Error', "Couldn't open the deposit page. Please try again.");
    });
  }, [depositAmount]);

  // ---- Withdraw ----------------------------------------------------------
  const handleWithdraw = useCallback(async () => {
    if (!user || withdrawSubmitting) return;

    const amount = parseFloat(withdrawAmount);
    if (!withdrawAmount || !Number.isFinite(amount) || amount <= 0 || amount > MAX_TRANSACTION_AMOUNT) {
      return;
    }
    if (summary && amount > summary.available) {
      return;
    }

    if (!withdrawIdemKeyRef.current) {
      withdrawIdemKeyRef.current = `${generateId()}-${Date.now().toString(36)}`;
    }

    setWithdrawSubmitting(true);
    setWithdrawError(undefined);
    try {
      const result = await apiService.withdraw(user.id, amount, withdrawIdemKeyRef.current);
      if (!mountedRef.current) return;
      success();
      withdrawIdemKeyRef.current = null;
      setActiveSheet(null);
      setWithdrawAmount('');
      if (result.duplicate) {
        Alert.alert('Already processed', 'This withdrawal was already submitted — no need to resubmit it.');
      }
      loadWallet({ silent: true });
    } catch (err) {
      if (!mountedRef.current) return;
      hapticError();
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/wallet');
      if (apiErr.code === 'INSUFFICIENT_FUNDS') {
        // Inline, next to the amount — not an Alert — since this is a
        // correctable input error, not a one-off failure.
        setWithdrawError(apiErr.userMessage);
      } else {
        Alert.alert('Withdrawal failed', apiErr.userMessage);
      }
    } finally {
      if (mountedRef.current) setWithdrawSubmitting(false);
    }
  }, [user, withdrawAmount, withdrawSubmitting, summary, loadWallet]);

  const renderTx = useCallback(({ item }: ListRenderItemInfo<Transaction>) => <TransactionRow item={item} />, []);
  const keyExtractor = useCallback((item: Transaction) => item.id, []);

  if (authLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <LoadingState style={styles.stateFill} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <EmptyState
          icon="log-in-outline"
          title="Sign in required"
          message="Sign in to see your wallet."
          style={styles.stateFill}
        />
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.scrollContent}>
          <SkeletonCard />
          <View style={styles.skeletonGap}>
            <SkeletonList count={4} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError && !summary) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ErrorState message={loadError.userMessage} onRetry={() => loadWallet()} style={styles.stateFill} />
      </SafeAreaView>
    );
  }

  if (!summary) {
    // Unreachable given the guards above, but keeps everything below this
    // point guaranteed non-null instead of sprinkling `summary!` everywhere.
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <LoadingState style={styles.stateFill} />
      </SafeAreaView>
    );
  }

  const available = safeAmount(summary.available);
  const escrowed = safeAmount(summary.escrow_held_total);
  const wpBalance = safeAmount(summary.wallet.wp_balance);
  const depositAmountNum = parseFloat(depositAmount);
  const depositValid = depositAmount.length > 0 && Number.isFinite(depositAmountNum) && depositAmountNum > 0 && depositAmountNum <= MAX_TRANSACTION_AMOUNT;
  const withdrawAmountNum = parseFloat(withdrawAmount);
  const withdrawValid =
    withdrawAmount.length > 0 &&
    Number.isFinite(withdrawAmountNum) &&
    withdrawAmountNum > 0 &&
    withdrawAmountNum <= MAX_TRANSACTION_AMOUNT &&
    withdrawAmountNum <= available;

  const listHeader = (
    <View>
      <Card elevated style={styles.heroCard}>
        <Text style={styles.heroLabel}>Available balance</Text>
        <Money amount={available} tone="auto" size="lg" style={styles.heroAmount} />
        <View style={styles.escrowRow}>
          {/* Escrow is money STATE, not a person — quiet info tone, same as
              the "Escrow $X" badge on EventDetailScreen, never amber. */}
          <Pill label={`${formatMoney(escrowed)} escrowed`} tone="info" icon="lock-closed-outline" />
        </View>
        <Text style={styles.escrowExplainer}>
          Escrowed funds are held for bets on events that haven&apos;t settled yet. They&apos;re yours — you just
          can&apos;t spend or withdraw them until the event resolves.
        </Text>
      </Card>

      {/* W — WagerPals' play currency — is a separate ledger from cash: no
          Stripe, no withdrawals, never interchangeable with $. Kept in its
          own card, visually apart from the $ area above. */}
      <Card style={styles.wCard}>
        <Text style={styles.wLabel}>W balance</Text>
        <WAmount value={wpBalance} tone="neutral" size="lg" style={styles.wAmountWrap} />
        <Text style={styles.wFaucetText}>Out of W? You get W10 back every day.</Text>
      </Card>

      <View style={styles.actionsRow}>
        <Button
          title="Add funds"
          onPress={openDeposit}
          variant="primary"
          icon="add-circle-outline"
          style={styles.actionButton}
        />
        <Button
          title="Withdraw"
          onPress={openWithdraw}
          variant="secondary"
          icon="arrow-up-circle-outline"
          style={styles.actionButton}
        />
      </View>

      {depositHandoffPending ? (
        <Card style={styles.handoffCard}>
          <Ionicons name="information-circle-outline" size={18} color={colors.brand} style={styles.handoffIcon} />
          <Text style={styles.handoffText}>
            Complete your deposit in the browser — we&apos;ll refresh your balance automatically when you&apos;re back.
          </Text>
        </Card>
      ) : null}

      <SectionHeader title="Recent activity" />
    </View>
  );

  const listEmptyComponent = (
    <EmptyState
      icon="receipt-outline"
      title="No transactions yet"
      message="Deposits, withdrawals, and bet activity will show up here."
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        // The signup grant seeds the W balance silently (owner: no
        // "welcome bonus" row in the ledger).
        data={summary.transactions.filter(
          (tx) => !(typeof tx.idempotency_key === 'string' && tx.idempotency_key.startsWith('signup-grant:'))
        )}
        renderItem={renderTx}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmptyComponent}
        contentContainerStyle={[
          styles.listContent,
          { flexGrow: 1, paddingBottom: TAB_BAR_HEIGHT + insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.brand2} />}
        initialNumToRender={10}
        windowSize={7}
        maxToRenderPerBatch={10}
        removeClippedSubviews
      />

      <BottomSheet visible={activeSheet === 'deposit'} onClose={closeSheet} title="Add funds" snapToContent>
        <AmountInput
          value={depositAmount}
          onChangeText={setDepositAmount}
          label="Amount to add"
          max={MAX_TRANSACTION_AMOUNT}
          quickAmounts={QUICK_DEPOSIT_AMOUNTS}
        />
        <View style={styles.depositNotice}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.brand} style={styles.depositNoticeIcon} />
          <Text style={styles.depositNoticeText}>
            You&apos;ll finish this securely on wagerpals.io in your browser — your card details never pass through
            this app. Come back here afterward and your balance updates automatically.
          </Text>
        </View>
        <Button
          title="Continue to secure payment"
          onPress={handleContinueDeposit}
          variant="primary"
          fullWidth
          disabled={!depositValid}
          icon="open-outline"
          iconPosition="right"
        />
      </BottomSheet>

      <BottomSheet visible={activeSheet === 'withdraw'} onClose={closeSheet} title="Withdraw" snapToContent>
        <AmountInput
          value={withdrawAmount}
          onChangeText={(v) => {
            setWithdrawAmount(v);
            setWithdrawError(undefined);
          }}
          label="Amount to withdraw"
          max={MAX_TRANSACTION_AMOUNT}
          available={available}
          error={withdrawError}
          quickAmounts={QUICK_WITHDRAW_AMOUNTS}
          editable={!withdrawSubmitting}
        />
        <Button
          title="Withdraw"
          onPress={handleWithdraw}
          variant="primary"
          fullWidth
          loading={withdrawSubmitting}
          disabled={!withdrawValid || withdrawSubmitting}
        />
      </BottomSheet>
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
    paddingTop: spacing.lg,
  },
  skeletonGap: {
    marginTop: spacing.lg,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  heroCard: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroLabel: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  heroAmount: {
    fontSize: 40,
    lineHeight: 46,
    marginBottom: spacing.md,
  },
  escrowRow: {
    marginBottom: spacing.sm,
  },
  escrowExplainer: {
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
    textAlign: 'center',
    lineHeight: tokens.lineHeight.xs,
    maxWidth: 300,
  },
  // W's own card — a separate ledger from cash, so it gets a separate
  // surface rather than living inside the $ hero card above.
  wCard: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    backgroundColor: colors.bg2,
  },
  wLabel: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  wAmountWrap: {
    marginBottom: spacing.sm,
  },
  wFaucetText: {
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  actionButton: {
    flex: 1,
  },
  handoffCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  handoffIcon: {
    marginRight: spacing.sm,
    marginTop: 2,
  },
  handoffText: {
    flex: 1,
    fontSize: tokens.fontSize.sm,
    color: colors.text,
    lineHeight: tokens.lineHeight.sm,
  },
  txCard: {
    marginBottom: spacing.sm,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  txIconChip: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    flexShrink: 0,
  },
  txTextCol: {
    flex: 1,
    minWidth: 0,
  },
  txLabel: {
    fontSize: tokens.fontSize.base,
    fontWeight: '500',
    color: colors.text,
    textTransform: 'capitalize',
    marginBottom: 2,
  },
  txMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  txTime: {
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
  },
  txAmount: {
    marginLeft: spacing.md,
    flexShrink: 0,
  },
  goldAmount: {
    color: tokens.color.gold,
  },
  depositNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.brandFill,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  depositNoticeIcon: {
    marginRight: spacing.sm,
    marginTop: 1,
  },
  depositNoticeText: {
    flex: 1,
    fontSize: tokens.fontSize.xs,
    color: colors.text,
    lineHeight: tokens.lineHeight.xs,
  },
});
