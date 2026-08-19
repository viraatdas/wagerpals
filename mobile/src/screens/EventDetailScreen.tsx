// Event Detail — the screen where bets are placed and settled. Ship-quality
// pass covering audit findings D3 (no way to resolve a bet from iOS), D12
// (wallet/escrow UI + the Deposit button kicking users out to Safari), and
// E3 (defensive side_stats lookups).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { colors, font, radius, spacing, tokens } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { EventWithStats, Bet, Comment, EscrowHoldStatus, WalletSummary } from '../types';
import { formatMoney, formatRelativeTime, truncate, handle } from '../utils/format';
import { tapLight, tapMedium, tapHeavy, success, error as hapticError } from '../utils/haptics';
import { ApiError, toApiError } from '../utils/errors';
import {
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonCard,
  SkeletonList,
  Card,
  Button,
  Pill,
  type PillTone,
  Avatar,
  SectionHeader,
  Money,
  SplitBar,
  Field,
  AmountInput,
  SegmentedControl,
  BottomSheet,
  TitleText,
} from '../components';

type EventDetailRouteProps = RouteProp<RootStackParamList, 'EventDetail'>;

// Mirrors lib/payments.ts MAX_TRANSACTION_AMOUNT exactly — that file is
// server-only and can't be imported into the mobile bundle, so this is kept
// in sync by hand. Only applies to cash-event bets without a fixed stake;
// see placeCashBet in lib/payments.ts.
const MAX_TRANSACTION_AMOUNT = 500;

const KEYBOARD_OFFSET = Platform.OS === 'ios' ? 90 : 0;

// The escrow chip, mirroring components/Ledger.tsx's HOLD_CHIPS so web and
// mobile never disagree about what a stake is doing. Data source, gating and
// labels are the invariant (CLAUDE.md §8) — only the LOOK below is styled to
// match: escrow status is money STATE, not a person, so — like the web
// version — it stays out of the amber "people" palette and out of the fully
// round Pill shape (reserved for people/status), using the structured 8px
// chip radius instead. Quiet neutral tones for held/released; a small
// emerald tint only once the money is actually back with its owner.
const HOLD_PILLS: Record<EscrowHoldStatus, { label: string }> = {
  held: { label: 'Escrowed' },
  released: { label: 'Settled' },
  refunded: { label: 'Refunded' },
};

const HOLD_CHIP_TONE: Record<EscrowHoldStatus, { bg: string; border: string; fg: string }> = {
  held: { bg: colors.surface, border: colors.border, fg: colors.textFaint },
  released: { bg: colors.surface, border: colors.border, fg: colors.textMuted },
  refunded: { bg: tokens.color.emeraldFill, border: tokens.color.emerald, fg: tokens.color.emerald },
};

function EscrowChip({ status, accessibilityLabel }: { status: EscrowHoldStatus; accessibilityLabel: string }) {
  const tone = HOLD_CHIP_TONE[status];
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.escrowChip, { backgroundColor: tone.bg, borderColor: tone.border }]}
    >
      <Text style={[styles.escrowChipText, { color: tone.fg }]}>{HOLD_PILLS[status].label}</Text>
    </View>
  );
}

/** Chips render on everyone's bets, so the label has to name whose stake it is. */
function holdPillLabel(status: EscrowHoldStatus, isOwnBet: boolean, username: string): string {
  const stake = isOwnBet ? 'your stake' : `${handle(username)}'s stake`;
  switch (status) {
    case 'held':
      return `${isOwnBet ? 'Your stake' : stake} is held until this event is resolved or cancelled.`;
    case 'released':
      return `This event was resolved and ${stake} left escrow.`;
    case 'refunded':
      return `This event was cancelled and ${stake} was returned.`;
  }
}

function BetRow({
  bet,
  sideAName,
  holdStatus,
  isOwnBet,
  canDelete,
  isDeleting,
  onDelete,
}: {
  bet: Bet;
  /** event.side_a — which side this bet's amount should read Emerald vs Crimson. */
  sideAName: string;
  /**
   * Live escrow status of THIS bet, from the event payload's `escrow_by_bet`.
   * Undefined for free events and for any bet with no hold. Deliberately not
   * derived from `bet.escrow_hold_id` — that stays set after settlement, so it
   * would pin every chip at "Escrowed" forever.
   */
  holdStatus?: EscrowHoldStatus;
  isOwnBet: boolean;
  canDelete: boolean;
  isDeleting: boolean;
  onDelete: (bet: Bet) => void;
}) {
  // A stake is a number, not a person — Emerald for side A, Crimson-ink (the
  // text-safe twin) for side B, same convention as the bet-form segmented
  // control and the confidence bar.
  const stakeColor = bet.side === sideAName ? tokens.color.emerald : tokens.color.crimsonInk;
  return (
    <View style={styles.rowItem}>
      <Avatar username={bet.username} size="sm" />
      <View style={styles.rowContent}>
        <Text style={styles.rowText} numberOfLines={3}>
          <Text style={styles.rowBold}>{handle(truncate(bet.username, 20))}</Text>
          {' bet '}
          <Money amount={bet.amount} size="sm" tone="neutral" style={{ color: stakeColor }} />
          {' on '}
          <Text style={styles.rowSide}>{truncate(bet.side, 24)}</Text>
        </Text>
        {bet.note ? (
          <Text style={styles.rowNote} numberOfLines={2}>
            {truncate(bet.note, 140)}
          </Text>
        ) : null}
        <View style={styles.rowMetaRow}>
          {holdStatus ? (
            <EscrowChip status={holdStatus} accessibilityLabel={holdPillLabel(holdStatus, isOwnBet, bet.username)} />
          ) : null}
          <Text style={styles.rowTime}>{formatRelativeTime(bet.timestamp)}</Text>
        </View>
      </View>
      {canDelete ? (
        <Pressable
          onPress={() => onDelete(bet)}
          disabled={isDeleting}
          accessibilityRole="button"
          accessibilityLabel="Delete bet"
          hitSlop={8}
          style={styles.rowDeleteButton}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color={colors.rose} />
          ) : (
            <Ionicons name="trash-outline" size={18} color={colors.rose} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function CommentRow({ comment }: { comment: Comment }) {
  return (
    <View style={styles.rowItem}>
      <Avatar username={comment.username} size="sm" />
      <View style={styles.rowContent}>
        <View style={styles.commentHeaderRow}>
          <Text style={styles.rowBold} numberOfLines={1}>
            {handle(truncate(comment.username, 24))}
          </Text>
          <Text style={styles.rowTime}>{formatRelativeTime(comment.timestamp)}</Text>
        </View>
        <Text style={styles.commentText}>{truncate(comment.content, 400)}</Text>
      </View>
    </View>
  );
}

export default function EventDetailScreen() {
  const route = useRoute<EventDetailRouteProps>();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { eventId } = route.params;
  const insets = useSafeAreaInsets();

  const [event, setEvent] = useState<EventWithStats | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  // Bet form state
  const [selectedSide, setSelectedSide] = useState<string | null>(null);
  const [betAmount, setBetAmount] = useState('');
  const [betNote, setBetNote] = useState('');
  const [isPlacingBet, setIsPlacingBet] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);
  const [betInsufficientFunds, setBetInsufficientFunds] = useState(false);

  // Comment form state
  const [commentText, setCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [footerHeight, setFooterHeight] = useState(0);

  // Bet deletion
  const [deletingBetId, setDeletingBetId] = useState<string | null>(null);

  // Manage (resolve/unresolve/delete) sheet — audit finding D3
  const [manageSheetVisible, setManageSheetVisible] = useState(false);
  const [resolveSide, setResolveSide] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [isCancellingEvent, setIsCancellingEvent] = useState(false);
  const [isUnresolving, setIsUnresolving] = useState(false);
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);

  const loadSeq = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Derived values computed from possibly-null `event` — kept above the
  // early returns below since one of them feeds a hook (the fixed-stake
  // sync effect right after).
  const isCash = event?.payment_type === 'cash';
  const hasFixedStake = isCash && event?.stake_amount != null && event.stake_amount > 0;

  // Cash events with a fixed stake always bet the same amount — lock the
  // field to it instead of letting the user type something the server will
  // reject with INVALID_STAKE. See lib/payments.ts placeCashBet: when
  // event.stake_amount is set, the bet amount must equal it exactly.
  useEffect(() => {
    if (hasFixedStake && event?.stake_amount != null) {
      setBetAmount(String(event.stake_amount));
    }
  }, [hasFixedStake, event?.stake_amount]);

  const loadEventData = useCallback(
    async (opts?: { isRefresh?: boolean }) => {
      const seq = ++loadSeq.current;
      if (opts?.isRefresh) setIsRefreshing(true);
      else setIsLoading(true);
      setLoadError(null);

      try {
        const { event: eventData, comments: commentsData, wallet: walletData } =
          await apiService.getEventScreenData(eventId, user?.id ?? null);
        if (seq !== loadSeq.current || !mountedRef.current) return;
        setEvent(eventData);
        setComments(Array.isArray(commentsData) ? commentsData : []);
        setWallet(walletData);
      } catch (err) {
        if (seq !== loadSeq.current || !mountedRef.current) return;
        setLoadError(err instanceof ApiError ? err : toApiError(err, '/api/events'));
      } finally {
        if (seq === loadSeq.current && mountedRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [eventId, user?.id]
  );

  useFocusEffect(
    useCallback(() => {
      loadEventData().catch(() => {});
    }, [loadEventData])
  );

  const handleRefresh = () => {
    // See apiService.invalidateForRefresh — the event detail read is
    // SWR-cached for 5s, and this is the screen people pull hardest on
    // (waiting to see a bet land or a result post).
    apiService.invalidateForRefresh('/api/events', '/api/comments', '/api/wallet');
    loadEventData({ isRefresh: true }).catch(() => {});
  };

  // Creator-only resolve/cancel: `event.created_by` is the source of truth.
  // Only fall back to the group's own creator for legacy events written
  // before that column was populated (a group fetch is otherwise wasted
  // work, and this is SWR-cached at 15s anyway so it's cheap when needed).
  const [groupCreatorId, setGroupCreatorId] = useState<string | null>(null);
  useEffect(() => {
    if (!event?.group_id || event.created_by) return;
    let cancelled = false;
    apiService
      .getGroup(event.group_id)
      .then((g) => {
        if (!cancelled) setGroupCreatorId(g.created_by ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [event?.group_id, event?.created_by]);

  // ---- Bet placement ----

  const numericBetAmount = parseFloat(betAmount);
  const hasValidBetAmount = betAmount.length > 0 && !isNaN(numericBetAmount) && numericBetAmount > 0;
  const overAvailable = !!wallet && hasValidBetAmount && numericBetAmount > wallet.available;
  const overCashMax = hasValidBetAmount && numericBetAmount > MAX_TRANSACTION_AMOUNT;
  const betAmountInvalid = !hasValidBetAmount || overAvailable || overCashMax;

  const handlePlaceBet = async () => {
    if (!user || !event || isPlacingBet) return;
    const side = selectedSide ?? event.side_a;
    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) {
      hapticError();
      setBetError('Enter a valid amount.');
      return;
    }

    tapMedium();
    setIsPlacingBet(true);
    setBetError(null);
    setBetInsufficientFunds(false);

    try {
      await apiService.createBet({
        event_id: event.id,
        user_id: user.id,
        username: user.displayName || user.primaryEmail || user.email || 'User',
        side,
        amount,
        note: betNote.trim() || undefined,
      });

      success();
      setBetNote('');
      if (!hasFixedStake) setBetAmount('');
      await loadEventData();
    } catch (err) {
      hapticError();
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/bets');
      if (apiErr.code === 'INSUFFICIENT_FUNDS') {
        setBetInsufficientFunds(true);
      }
      setBetError(apiErr.userMessage);
    } finally {
      setIsPlacingBet(false);
    }
  };

  // ---- Comments (optimistic append, rollback on failure) ----

  const handlePostComment = async () => {
    if (!user || !event || isPostingComment) return;
    const text = commentText.trim();
    if (!text) return;

    tapLight();
    setIsPostingComment(true);

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const username = user.displayName || user.primaryEmail || user.email || 'User';
    const optimisticComment: Comment = {
      id: tempId,
      event_id: event.id,
      user_id: user.id,
      username,
      content: text,
      timestamp: Date.now(),
    };
    setComments((prev) => [optimisticComment, ...prev]);
    setCommentText('');

    try {
      const created = await apiService.createComment({
        event_id: event.id,
        user_id: user.id,
        username,
        content: text,
      });
      success();
      setComments((prev) => prev.map((c) => (c.id === tempId ? created : c)));
    } catch (err) {
      hapticError();
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setCommentText(text);
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/comments');
      Alert.alert('Comment failed', apiErr.userMessage);
    } finally {
      setIsPostingComment(false);
    }
  };

  // ---- Bet deletion ----

  const handleDeleteBet = async (betId: string) => {
    setDeletingBetId(betId);
    try {
      await apiService.deleteBet(betId);
      success();
      await loadEventData();
    } catch (err) {
      hapticError();
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/bets');
      Alert.alert("Couldn't delete bet", apiErr.userMessage);
    } finally {
      setDeletingBetId(null);
    }
  };

  const confirmDeleteBet = (bet: Bet) => {
    Alert.alert('Delete this bet?', `Remove your ${formatMoney(bet.amount)} bet on "${bet.side}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => handleDeleteBet(bet.id) },
    ]);
  };

  // ---- Resolve / unresolve / delete event (audit finding D3) ----

  const handleResolve = async (side: string) => {
    if (!event) return;
    setManageError(null);
    setIsResolving(true);
    try {
      await apiService.resolveEvent(event.id, side, 'resolve');
      success();
      setManageSheetVisible(false);
      await loadEventData();
    } catch (err) {
      hapticError();
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/events/resolve');
      setManageError(apiErr.userMessage);
    } finally {
      setIsResolving(false);
    }
  };

  const confirmResolve = () => {
    if (!event) return;
    const side = resolveSide ?? event.side_a;
    const consequence = `"${side}" will be marked the winner and ${formatMoney(event.escrow_total ?? 0)} in escrowed funds will be paid out to winners. Undo only with Unresolve.`;
    Alert.alert('Resolve event?', consequence, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resolve', style: 'destructive', onPress: () => { tapMedium(); handleResolve(side); } },
    ]);
  };

  const handleCancelEvent = async () => {
    if (!event) return;
    setManageError(null);
    setIsCancellingEvent(true);
    try {
      // winningSide is ignored server-side for action: 'cancel'.
      await apiService.resolveEvent(event.id, event.side_a, 'cancel');
      success();
      setManageSheetVisible(false);
      await loadEventData();
    } catch (err) {
      hapticError();
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/events/resolve');
      setManageError(apiErr.userMessage);
    } finally {
      setIsCancellingEvent(false);
    }
  };

  const confirmCancelEvent = () => {
    Alert.alert(
      'Cancel & refund?',
      'Every escrowed stake on this event will be refunded to bettors, and the event will be marked resolved with no winner. This cannot be undone.',
      [
        { text: 'Back', style: 'cancel' },
        { text: 'Cancel & refund', style: 'destructive', onPress: () => { tapHeavy(); handleCancelEvent(); } },
      ]
    );
  };

  const handleUnresolve = async () => {
    if (!event) return;
    setManageError(null);
    setIsUnresolving(true);
    try {
      await apiService.unresolveEvent(event.id);
      success();
      setManageSheetVisible(false);
      await loadEventData();
    } catch (err) {
      hapticError();
      // A 409 (REVERSAL_BLOCKED) lands here too — ApiError.userMessage
      // already carries the server's exact explanation.
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/events/unresolve');
      setManageError(apiErr.userMessage);
    } finally {
      setIsUnresolving(false);
    }
  };

  const confirmUnresolve = () => {
    Alert.alert(
      'Unresolve event?',
      'This reopens the event for betting and reverses any payouts already made.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unresolve', style: 'destructive', onPress: () => { tapHeavy(); handleUnresolve(); } },
      ]
    );
  };

  const handleDeleteEvent = async () => {
    if (!event) return;
    setManageError(null);
    setIsDeletingEvent(true);
    try {
      await apiService.deleteEvent(event.id);
      success();
      setManageSheetVisible(false);
      navigation.goBack();
    } catch (err) {
      hapticError();
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/events/delete');
      setManageError(apiErr.userMessage);
    } finally {
      setIsDeletingEvent(false);
    }
  };

  const confirmDeleteEvent = () => {
    // Both cash and W bets can be held in escrow (W-CURRENCY-SPEC.md), so
    // the "cancel & refund first" caveat applies regardless of currency.
    Alert.alert(
      'Delete event?',
      'This permanently deletes the event and all its bets. If stakes are still held in escrow, cancel & refund first.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { tapHeavy(); handleDeleteEvent(); } },
      ]
    );
  };

  // ---- Loading / error states ----

  if (isLoading && !event) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.headerSection}>
            <Skeleton width="70%" height={26} style={styles.skeletonGap} />
            <Skeleton width="40%" height={16} />
          </View>
          <View style={styles.sidesRow}>
            <View style={styles.flex}>
              <SkeletonCard />
            </View>
            <View style={styles.flex}>
              <SkeletonCard />
            </View>
          </View>
          <View style={styles.skeletonSection}>
            <SkeletonCard />
          </View>
          <View style={styles.skeletonSection}>
            <SkeletonList count={4} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (loadError && !event) {
    const isNotFound = loadError.status === 404;
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.centerFill}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.brand} />}
        >
          {isNotFound ? (
            <EmptyState
              icon="alert-circle-outline"
              title="Event not found"
              message="This event may have been deleted."
              actionLabel="Go back"
              onAction={() => navigation.goBack()}
            />
          ) : (
            <ErrorState message={loadError.userMessage} onRetry={handleRefresh} />
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!event) {
    // Shouldn't happen (covered by the two branches above), but keeps this
    // component crash-safe if state ever gets here some other way.
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.centerFill}>
          <EmptyState icon="alert-circle-outline" title="Event not found" message="Nothing to show here." />
        </View>
      </SafeAreaView>
    );
  }

  // ---- Everything below has a guaranteed non-null `event` ----

  const isActive = event.status === 'active';
  const isResolved = event.status === 'resolved';
  const isCancelled = isResolved && !event.resolution;
  const winningSide = event.resolution?.winning_side;

  const sideAStats = event.side_stats?.[event.side_a] ?? { count: 0, total: 0 };
  const sideBStats = event.side_stats?.[event.side_b] ?? { count: 0, total: 0 };

  // Creator-only resolve/cancel/delete — mirrors
  // app/api/events/resolve|unresolve|delete/route.ts: only the caller whose
  // id equals event.created_by may manage the event, full stop. There is no
  // resolver concept, no "public group means anyone can" carve-out, and no
  // payment-type distinction anymore. `groupCreatorId` is only consulted
  // for legacy events with no created_by recorded.
  const effectiveCreatorId = event.created_by ?? groupCreatorId;
  const canManage = !!user && !!effectiveCreatorId && user.id === effectiveCreatorId;

  const subjectBet = event.bets?.find((b) => b.user_id === event.subject_user_id);
  const subjectLabel = subjectBet ? handle(truncate(subjectBet.username, 24)) : 'a group member';

  const sortedBets = [...(event.bets ?? [])].sort((a, b) => b.timestamp - a.timestamp);
  const sortedComments = [...comments].sort((a, b) => b.timestamp - a.timestamp);

  // No-expiry status mapping: active -> "Live", resolved -> "Settled".
  const statusLabel = isResolved ? (isCancelled ? 'Cancelled' : 'Settled') : 'Live';
  const statusTone: PillTone = isResolved ? (isCancelled ? 'neutral' : 'yes') : 'yes';

  const effectiveResolveSide = resolveSide ?? event.side_a;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={KEYBOARD_OFFSET}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + footerHeight + spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.brand} />}
        >
          {loadError && event ? (
            <ErrorState compact title="Couldn't refresh" message={loadError.userMessage} onRetry={handleRefresh} style={styles.inlineError} />
          ) : null}

          {isResolved && (
            <Card style={styles.bannerCard}>
              <View style={styles.bannerRow}>
                <Ionicons
                  name={isCancelled ? 'close-circle-outline' : 'trophy'}
                  size={20}
                  color={isCancelled ? colors.textMuted : colors.mint}
                />
                <Text style={styles.bannerText} numberOfLines={2}>
                  {isCancelled
                    ? 'Cancelled. Every stake was refunded.'
                    : `Resolved. "${truncate(winningSide ?? '', 40)}" won.`}
                </Text>
              </View>
            </Card>
          )}

          {/* Header */}
          <View style={styles.headerSection}>
            <View style={styles.headerTopRow}>
              <TitleText title={event.title} style={styles.eventTitle} numberOfLines={3} ellipsizeMode="tail" />
              {canManage ? (
                <Pressable
                  onPress={() => {
                    setManageError(null);
                    setResolveSide(event.side_a);
                    setManageSheetVisible(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Manage event"
                  hitSlop={8}
                  style={styles.manageIconButton}
                >
                  <Ionicons name="settings-outline" size={22} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>

            {event.description ? (
              <Text style={styles.eventDescription} numberOfLines={4}>
                {event.description}
              </Text>
            ) : null}

            <View style={styles.badgeRow}>
              <Pill label={statusLabel} tone={statusTone} />
              {isCash ? <Pill icon="cash-outline" label="Cash" tone="info" /> : null}
            </View>

            {event.creator_username ? (
              <Text style={styles.resolverText} numberOfLines={1}>
                Started by {handle(event.creator_username)}
              </Text>
            ) : null}

            {event.subject_user_id ? (
              <View style={styles.subjectRow}>
                <Pill icon="person-outline" label={`About ${subjectLabel}`} tone="pending" size="sm" />
                {event.notify_subject === false ? (
                  <Text style={styles.subjectNote}>They weren't notified about this bet.</Text>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Wallet / escrow (audit finding D12) — cash events only */}
          {isCash ? (
            <Card style={styles.walletCard}>
              {user ? (
                wallet ? (
                  <>
                    <View style={styles.walletRow}>
                      <View style={styles.walletCol}>
                        <Text style={styles.walletLabel}>Your available balance</Text>
                        <Money amount={wallet.available} tone="neutral" size="lg" />
                      </View>
                      <Pill label={`Escrow ${formatMoney(event.escrow_total ?? 0)}`} tone="info" />
                    </View>
                    <Text style={styles.walletSubLabel}>
                      {formatMoney(wallet.event?.escrow_held ?? 0)} of yours is held in escrow on this event
                    </Text>
                  </>
                ) : (
                  <Text style={styles.walletUnavailable}>Couldn't load your wallet. Pull to refresh.</Text>
                )
              ) : (
                <Text style={styles.walletUnavailable}>Sign in to see your balance and place cash bets.</Text>
              )}
            </Card>
          ) : null}

          {/* Side stats */}
          <View style={styles.sidesRow}>
            <Card style={[styles.sideCard, winningSide === event.side_a && styles.sideCardWinner]}>
              <Text style={styles.sideName} numberOfLines={2}>
                {truncate(event.side_a, 24)}
              </Text>
              <Money amount={sideAStats.total} tone="neutral" size="lg" style={styles.sideAMoney} />
              <Text style={styles.sideCount}>
                {sideAStats.count} bet{sideAStats.count === 1 ? '' : 's'}
              </Text>
              {winningSide === event.side_a ? <Pill label="Winner" tone="yes" icon="trophy" size="sm" /> : null}
            </Card>
            <Text style={styles.vsText}>vs</Text>
            <Card style={[styles.sideCard, winningSide === event.side_b && styles.sideCardWinner]}>
              <Text style={styles.sideName} numberOfLines={2}>
                {truncate(event.side_b, 24)}
              </Text>
              <Money amount={sideBStats.total} tone="neutral" size="lg" style={styles.sideBMoney} />
              <Text style={styles.sideCount}>
                {sideBStats.count} bet{sideBStats.count === 1 ? '' : 's'}
              </Text>
              {winningSide === event.side_b ? <Pill label="Winner" tone="yes" icon="trophy" size="sm" /> : null}
            </Card>
          </View>
          {/* The confidence bar — WagerPals' signature element. Full-size
              treatment here (14px vs the 8px card version) since this is the
              detail view; per-side context comes from aLabel/bLabel. */}
          <View style={styles.splitBarWrap}>
            <SplitBar
              aValue={sideAStats.total}
              bValue={sideBStats.total}
              aLabel={truncate(event.side_a, 16)}
              bLabel={truncate(event.side_b, 16)}
              height={14}
            />
          </View>

          {/* Bet form */}
          {isActive ? (
            <Card style={styles.formCard}>
              <SectionHeader title="Place your bet" />
              {!user ? (
                <Text style={styles.mutedNotice}>Sign in to place a bet.</Text>
              ) : (
                <>
                  <SegmentedControl
                    options={[
                      { value: event.side_a, label: truncate(event.side_a, 18), tone: 'mint' },
                      { value: event.side_b, label: truncate(event.side_b, 18), tone: 'rose' },
                    ]}
                    value={selectedSide ?? event.side_a}
                    onChange={setSelectedSide}
                  />

                  <View style={styles.amountSpacer}>
                    <AmountInput
                      value={betAmount}
                      onChangeText={(v) => {
                        setBetAmount(v);
                        setBetError(null);
                        setBetInsufficientFunds(false);
                      }}
                      quickAmounts={hasFixedStake ? undefined : [5, 10, 25, 50]}
                      max={MAX_TRANSACTION_AMOUNT}
                      available={wallet?.available}
                      editable={!hasFixedStake && !isPlacingBet}
                    />
                  </View>

                  {hasFixedStake ? (
                    <Text style={styles.fixedStakeHint}>
                      This event has a fixed stake of {formatMoney(event.stake_amount ?? 0)}. Every bet is the same amount.
                    </Text>
                  ) : null}

                  {overAvailable || betInsufficientFunds ? (
                    <View style={styles.fundsRow}>
                      <Text style={styles.fundsText} numberOfLines={3}>
                        {betInsufficientFunds && betError
                          ? betError
                          : `You need ${formatMoney(Math.max(0, numericBetAmount - (wallet?.available ?? 0)))} more to place this bet.`}
                      </Text>
                      <Button
                        title="Add funds"
                        size="sm"
                        variant="secondary"
                        onPress={() => navigation.navigate('Wallet')}
                      />
                    </View>
                  ) : null}

                  <Field
                    label="Note (optional)"
                    value={betNote}
                    onChangeText={setBetNote}
                    placeholder="Add a note…"
                    maxLength={200}
                    showCount
                  />

                  {betError && !betInsufficientFunds && !overAvailable ? (
                    <Text style={styles.betErrorText}>{betError}</Text>
                  ) : null}

                  <Button
                    title={isPlacingBet ? 'Placing bet…' : 'Place bet'}
                    onPress={handlePlaceBet}
                    variant="primary"
                    fullWidth
                    loading={isPlacingBet}
                    disabled={isPlacingBet || betAmountInvalid}
                    haptic="none"
                  />
                </>
              )}
            </Card>
          ) : null}

          {/* Bets */}
          <View style={styles.sectionBlock}>
            <SectionHeader title={sortedBets.length ? `Bets (${sortedBets.length})` : 'Bets'} />
            {sortedBets.length === 0 ? (
              <EmptyState compact icon="cash-outline" title="No bets yet" message="Be the first to place one." />
            ) : (
              sortedBets.map((bet) => (
                <BetRow
                  key={bet.id}
                  bet={bet}
                  sideAName={event.side_a}
                  // Every player's chip, not just the viewer's — see
                  // scripts/verify-escrow-chips.ts.
                  holdStatus={event.escrow_by_bet?.[bet.id]}
                  isOwnBet={!!user && user.id === bet.user_id}
                  // Cash bets are immutable once placed — the stake is
                  // escrowed and deleting the bet would strand it (see
                  // app/api/bets/route.ts DELETE, CASH_BET_IMMUTABLE). Don't
                  // offer an affordance that's guaranteed to fail.
                  canDelete={!!user && user.id === bet.user_id && !isCash}
                  isDeleting={deletingBetId === bet.id}
                  onDelete={confirmDeleteBet}
                />
              ))
            )}
          </View>

          {/* Comments */}
          <View style={styles.sectionBlock}>
            <SectionHeader title={sortedComments.length ? `Comments (${sortedComments.length})` : 'Comments'} />
            {sortedComments.length === 0 ? (
              <EmptyState compact icon="chatbubble-outline" title="No comments yet" message="Say something to start the conversation." />
            ) : (
              sortedComments.map((comment) => <CommentRow key={comment.id} comment={comment} />)
            )}
          </View>
        </ScrollView>

        {/* Comment composer — pinned above the keyboard/home indicator, never covered. */}
        <View
          style={[styles.commentFooter, { paddingBottom: insets.bottom + spacing.md }]}
          onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
        >
          <View style={styles.commentComposerRow}>
            <TextInput
              style={styles.commentInput}
              placeholder={user ? 'Say something…' : 'Sign in to comment'}
              placeholderTextColor={colors.textFaint}
              value={commentText}
              onChangeText={setCommentText}
              editable={!!user && !isPostingComment}
              multiline
              maxLength={500}
              returnKeyType="default"
            />
            <Pressable
              onPress={handlePostComment}
              disabled={!user || isPostingComment || !commentText.trim()}
              accessibilityRole="button"
              accessibilityLabel="Post comment"
              style={({ pressed }) => [
                styles.commentSendButton,
                (!user || isPostingComment || !commentText.trim()) && styles.commentSendButtonDisabled,
                pressed && styles.commentSendButtonPressed,
              ]}
            >
              {isPostingComment ? (
                <ActivityIndicator color={tokens.color.amberInk} size="small" />
              ) : (
                <Ionicons name="send" size={18} color={tokens.color.amberInk} />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Manage sheet — resolve / cancel & refund / unresolve / delete. */}
      <BottomSheet visible={manageSheetVisible} onClose={() => setManageSheetVisible(false)} title="Manage event">
        {manageError ? (
          <View style={styles.manageErrorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.rose} />
            <Text style={styles.manageErrorText}>{manageError}</Text>
          </View>
        ) : null}

        {isActive ? (
          <View style={styles.manageSection}>
            <Text style={styles.manageSectionTitle}>Pick the winner</Text>
            <SegmentedControl
              options={[
                { value: event.side_a, label: truncate(event.side_a, 16) },
                { value: event.side_b, label: truncate(event.side_b, 16) },
              ]}
              value={effectiveResolveSide}
              onChange={setResolveSide}
            />
            <Button
              title={`Resolve: ${truncate(effectiveResolveSide, 20)} wins`}
              onPress={confirmResolve}
              variant="primary"
              loading={isResolving}
              disabled={isResolving || isCancellingEvent}
              style={styles.manageButton}
            />
            {/* Cash and W bets both stake through the wallet/escrow engine
                (W-CURRENCY-SPEC.md), so cancel & refund applies to both —
                not cash-only. */}
            <Button
              title="Cancel & refund everyone"
              onPress={confirmCancelEvent}
              variant="danger"
              loading={isCancellingEvent}
              disabled={isResolving || isCancellingEvent}
              style={styles.manageButton}
            />
          </View>
        ) : null}

        {isResolved ? (
          <View style={styles.manageSection}>
            <Button
              title="Unresolve"
              onPress={confirmUnresolve}
              variant="secondary"
              loading={isUnresolving}
              disabled={isUnresolving}
              style={styles.manageButton}
            />
          </View>
        ) : null}

        <View style={styles.manageSection}>
          <Button
            title="Delete event"
            onPress={confirmDeleteEvent}
            variant="danger"
            loading={isDeletingEvent}
            disabled={isDeletingEvent}
            style={styles.manageButton}
          />
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  centerFill: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  skeletonGap: {
    marginBottom: spacing.sm,
  },
  skeletonSection: {
    marginTop: spacing.lg,
  },
  inlineError: {
    marginBottom: spacing.lg,
    backgroundColor: colors.bg2,
    borderRadius: radius.lg,
  },

  // Resolution / cancellation banner
  bannerCard: {
    marginBottom: spacing.lg,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bannerText: {
    flex: 1,
    fontSize: tokens.fontSize.base,
    fontWeight: '600',
    color: colors.text,
  },

  // Header
  headerSection: {
    marginBottom: spacing.lg,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  eventTitle: {
    flex: 1,
    fontSize: tokens.fontSize['2xl'],
    fontWeight: '700',
    color: colors.text,
  },
  manageIconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventDescription: {
    marginTop: spacing.xs,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    lineHeight: tokens.lineHeight.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  resolverText: {
    marginTop: spacing.sm,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
  },
  subjectRow: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  subjectNote: {
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
  },

  // Wallet
  walletCard: {
    marginBottom: spacing.lg,
  },
  walletRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  walletCol: {
    flex: 1,
    minWidth: 0,
  },
  walletLabel: {
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  walletSubLabel: {
    marginTop: spacing.sm,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
  },
  walletUnavailable: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
  },

  // Sides
  sidesRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sideCard: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  sideCardWinner: {
    borderColor: colors.mint,
  },
  sideName: {
    fontSize: tokens.fontSize.base,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  // A stake is a number, not a person — Emerald for side A, Crimson for
  // side B, the same convention the bet-form SegmentedControl and the
  // confidence bar already use.
  sideAMoney: {
    color: tokens.color.emerald,
  },
  sideBMoney: {
    color: tokens.color.crimson,
  },
  sideCount: {
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
  },
  vsText: {
    fontSize: tokens.fontSize.sm,
    fontWeight: '700',
    color: colors.textFaint,
    alignSelf: 'center',
  },
  splitBarWrap: {
    marginBottom: spacing.lg,
  },

  // Bet form
  formCard: {
    marginBottom: spacing.lg,
  },
  mutedNotice: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  noticeRowWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginBottom: spacing.md,
    backgroundColor: colors.amberFill,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  warningNoticeText: {
    flex: 1,
    fontSize: tokens.fontSize.xs,
    color: colors.amber,
    fontWeight: '600',
  },
  amountSpacer: {
    marginTop: spacing.lg,
  },
  fixedStakeHint: {
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
  },
  fundsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.roseFill,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  fundsText: {
    flex: 1,
    fontSize: tokens.fontSize.xs,
    color: colors.rose,
    fontWeight: '600',
  },
  betErrorText: {
    fontSize: tokens.fontSize.xs,
    color: colors.rose,
    marginBottom: spacing.md,
  },

  // Bets / Comments rows
  sectionBlock: {
    marginBottom: spacing.xl,
  },
  rowItem: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  rowText: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    lineHeight: tokens.lineHeight.sm,
  },
  rowBold: {
    fontWeight: '700',
    color: colors.text,
  },
  rowSide: {
    fontWeight: '700',
    color: colors.brand,
  },
  rowNote: {
    marginTop: 2,
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  rowMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  rowTime: {
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
  },
  // Escrow status chip — structured 8px radius (NOT the fully-rounded Pill
  // shape), matching components/Ledger.tsx's HOLD_CHIPS exactly: this
  // describes a state a number is in, not a person or a page-level status.
  escrowChip: {
    borderRadius: tokens.radius.chip,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  escrowChipText: {
    fontFamily: font.monoMedium,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  rowDeleteButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  commentText: {
    marginTop: 2,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    lineHeight: tokens.lineHeight.sm,
  },

  // Comment composer footer — the "human" zone (DESIGN-SPEC's friend-chaos
  // half): warm Amber accent on the send affordance, same accent the Avatar
  // ring already carries through this section, instead of the money-toned
  // Emerald used everywhere else in this screen.
  commentFooter: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  commentComposerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  commentInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: tokens.fontSize.base,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 100,
  },
  commentSendButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    // Amber fill + amber-ink icon — matches Avatar's ring/fill pairing so
    // the "post a comment" action reads as part of the human zone, not a
    // money action (which would be Emerald).
    backgroundColor: tokens.color.amberFill,
    borderWidth: 1,
    borderColor: tokens.color.amber,
  },
  commentSendButtonDisabled: {
    opacity: 0.45,
  },
  commentSendButtonPressed: {
    opacity: 0.85,
  },

  // Manage sheet
  manageErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.roseFill,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  manageErrorText: {
    flex: 1,
    fontSize: tokens.fontSize.xs,
    color: colors.rose,
  },
  manageSection: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  manageSectionTitle: {
    fontSize: tokens.fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
  },
  manageButton: {
    marginTop: spacing.sm,
  },
});
