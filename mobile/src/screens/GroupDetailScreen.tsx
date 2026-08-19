// Group Detail Screen - Shows group info and events. Events render in a
// FlatList (not a ScrollView + .map()) so a group with hundreds of events
// only mounts the rows currently on/near screen.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  Pressable,
  StyleSheet,
  RefreshControl,
  Share,
  Linking,
  Clipboard,
  ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { Event, EventWithStats, Group, GroupMember, WalletSummary } from '../types';
import { ApiError, toApiError } from '../utils/errors';
import { tapLight } from '../utils/haptics';
import { handle } from '../utils/format';
import { colors, font, gradients, radius, spacing, tokens, glow } from '../theme';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Money,
  TitleText,
  Pill,
  SectionHeader,
  Skeleton,
  SkeletonCard,
  SkeletonList,
  SplitBar,
} from '../components';

type GroupData = Group & { members?: GroupMember[]; pending_requests?: GroupMember[] };

type EventListItem =
  | { kind: 'section'; id: string; label: string }
  | { kind: 'event'; id: string; event: Event };

const EventRow = React.memo(function EventRow({
  event,
  onPress,
}: {
  event: Event;
  onPress: (eventId: string) => void;
}) {
  const isResolved = event.status === 'resolved';
  const isCash = event.payment_type === 'cash';
  // GET /api/events (list) includes side_stats/total_bets/total_participants
  // at runtime even though the plain `Event` type (shared with POST bodies)
  // doesn't declare them — narrow locally rather than touching shared types.
  const stats = (event as EventWithStats).side_stats;
  const aTotal = stats?.[event.side_a]?.total ?? 0;
  const bTotal = stats?.[event.side_b]?.total ?? 0;
  const pot = aTotal + bTotal;

  return (
    <Card onPress={() => onPress(event.id)} style={styles.eventCard} accessibilityLabel={event.title}>
      <View style={styles.eventHeaderRow}>
        <TitleText title={event.title} style={styles.eventTitle} numberOfLines={2} ellipsizeMode="tail" />
        <Money amount={pot} tone="neutral" size="sm" />
      </View>

      <SplitBar aValue={aTotal} bValue={bTotal} aLabel={event.side_a} bLabel={event.side_b} />

      <View style={styles.eventFooterRow}>
        {/* No-expiry status mapping: active -> "Live", resolved -> "Settled". */}
        <Pill label={isResolved ? 'Settled' : 'Live'} tone={isResolved ? 'yes' : 'brand'} />
        {isCash && <Pill label="Cash" tone="info" />}
      </View>
    </Card>
  );
});

export default function GroupDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { user } = useAuth();
  const { groupId } = route.params as { groupId: string };

  const [group, setGroup] = useState<GroupData | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [walletSummary, setWalletSummary] = useState<WalletSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [userStatus, setUserStatus] = useState<'active' | 'pending'>('active');
  const [copied, setCopied] = useState(false);

  const loadSeq = useRef(0);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const loadGroupData = useCallback(
    async (opts?: { isRefresh?: boolean }) => {
      // Early return BEFORE the try block — still has to clear the loading
      // flags on this path or the screen spins forever for a signed-out user.
      if (!user) {
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      const seq = ++loadSeq.current;
      if (opts?.isRefresh) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);

      try {
        const { group: groupData, events: eventsData } = await apiService.getGroupScreenData(groupId);
        if (seq !== loadSeq.current) return; // superseded by a newer load

        const userMember = groupData.members?.find((m) => m.user_id === user.id);
        // Flat-groups model: the only admin is the creator.
        const nextIsCreator = groupData.created_by === user.id;
        const nextStatus: 'active' | 'pending' = userMember?.status || 'pending';

        // Members and wallet are independent of each other and of the
        // group/events fetch above — fire them concurrently. The wallet leg
        // is optional context (cash balance shown when the group has cash
        // wagers on) and must degrade to null rather than failing the whole
        // screen.
        const [membersData, walletData] = await Promise.all([
          groupData.members
            ? Promise.resolve(groupData.members)
            : apiService.getGroupMembers(groupId).catch((err) => {
                console.warn('[GroupDetail] members leg failed:', err);
                return [] as GroupMember[];
              }),
          groupData.cash_enabled
            ? apiService.getWallet(user.id).catch((err) => {
                console.warn('[GroupDetail] optional wallet leg failed:', err);
                return null;
              })
            : Promise.resolve(null),
        ]);

        if (seq !== loadSeq.current) return;

        setGroup(groupData);
        setEvents(eventsData);
        setIsCreator(nextIsCreator);
        setUserStatus(nextStatus);
        setMembers(membersData);
        setWalletSummary(walletData);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        setError(err instanceof ApiError ? err : toApiError(err, '/api/groups'));
      } finally {
        if (seq === loadSeq.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [groupId, user]
  );

  useFocusEffect(
    useCallback(() => {
      loadGroupData().catch(() => {});
    }, [loadGroupData])
  );

  const handleRefresh = useCallback(() => {
    // See apiService.invalidateForRefresh — both legs of this screen are
    // SWR-cached (groups 15s, events 5s).
    apiService.invalidateForRefresh('/api/groups', '/api/events');
    loadGroupData({ isRefresh: true }).catch(() => {});
  }, [loadGroupData]);

  // Audit finding D12: this used to be
  // `Linking.openURL('https://wagerpals.io/profile?wallet=deposit')`, which
  // ejected the user into Safari mid-flow — and against a hardcoded
  // production domain, so in development it sent you to the live site. There
  // is a real in-app Wallet screen now, so route there instead.
  const handleDeposit = useCallback(() => {
    navigation.navigate('Wallet' as never);
  }, [navigation]);

  const handleShareInvite = useCallback(async () => {
    try {
      const groupName = group?.name || 'my group';
      const message = `Join my betting group "${groupName}" on WagerPals!\n\nUse code: ${groupId}\n\nOr click: wagerpals://groups/join/${groupId}`;
      await Share.share({ message, title: `Join ${groupName} on WagerPals` });
    } catch (err) {
      console.warn('[GroupDetail] failed to share invite:', err);
    }
  }, [group?.name, groupId]);

  const handleCopyCode = useCallback(() => {
    try {
      Clipboard.setString(groupId);
      tapLight();
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // Best-effort — the code is still visible on screen to copy manually.
      console.warn('[GroupDetail] clipboard copy failed:', err);
    }
  }, [groupId]);

  const handleEventPress = useCallback(
    (eventId: string) => {
      navigation.navigate('EventDetail' as never, { eventId } as never);
    },
    [navigation]
  );

  const handleCreateEvent = useCallback(() => {
    navigation.navigate('CreateEvent' as never, { groupId } as never);
  }, [navigation, groupId]);

  const handleManageGroup = useCallback(() => {
    navigation.navigate('GroupAdmin' as never, { groupId } as never);
  }, [navigation, groupId]);

  // No-expiry rules: status is the only thing that splits the list now —
  // end_time no longer closes an event, so it can't decide this.
  const { activeEvents, endedEvents } = useMemo(
    () => ({
      activeEvents: events.filter((e) => e.status === 'active'),
      endedEvents: events.filter((e) => e.status === 'resolved'),
    }),
    [events]
  );

  const listItems = useMemo<EventListItem[]>(() => {
    const items: EventListItem[] = [];
    if (activeEvents.length > 0) {
      items.push({ kind: 'section', id: 'section-active', label: `Live (${activeEvents.length})` });
      activeEvents.forEach((e) => items.push({ kind: 'event', id: e.id, event: e }));
    }
    if (endedEvents.length > 0) {
      items.push({ kind: 'section', id: 'section-ended', label: `Settled (${endedEvents.length})` });
      endedEvents.forEach((e) => items.push({ kind: 'event', id: e.id, event: e }));
    }
    return items;
  }, [activeEvents, endedEvents]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<EventListItem>) => {
      if (item.kind === 'section') {
        return (
          <View style={styles.sectionHeaderWrap}>
            <SectionHeader title={item.label} />
          </View>
        );
      }
      return <EventRow event={item.event} onPress={handleEventPress} />;
    },
    [handleEventPress]
  );

  // ---- Initial load: full-screen skeleton matching the real content shape ----
  if (isLoading && !group) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.header}>
          <Skeleton width="65%" height={26} style={{ marginBottom: spacing.sm }} />
          <Skeleton width="45%" height={14} />
        </View>
        <View style={styles.skeletonBody}>
          <SkeletonCard />
          <View style={{ marginTop: spacing.lg }}>
            <SkeletonList count={4} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ---- Initial-load failure: nothing cached to show, full-screen error ----
  if (error && !group) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.centerFill}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.brand} />}
        >
          <ErrorState message={error.userMessage} onRetry={handleRefresh} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Pending approval ----
  // Joins by code are instantly active now (flat-groups model) — a
  // 'pending' status can only survive on a legacy row written before that
  // change, so this is a rare fallback, not the normal join path.
  if (userStatus === 'pending') {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.centerFill}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.brand} />}
        >
          <View style={styles.pendingContainer}>
            <View style={styles.pendingIconChip}>
              <Ionicons name="hourglass-outline" size={32} color={colors.amber} />
            </View>
            <Text style={styles.pendingTitle}>Waiting on the creator</Text>
            <Text style={styles.pendingText} numberOfLines={3} ellipsizeMode="tail">
              Your request to join "{group?.name}" hasn't been approved yet.
            </Text>
            <Text style={styles.pendingSubtext}>You'll be notified when you're in.</Text>
            <Button title="Go Back" variant="secondary" onPress={() => navigation.goBack()} style={styles.pendingButton} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const cashEnabled = !!group?.cash_enabled;
  const available = walletSummary?.available ?? walletSummary?.wallet.balance ?? 0;
  // Group has no creator_username field of its own (unlike Event) — derive
  // it from the already-loaded member roster instead of inventing a field.
  const creatorUsername = members.find((m) => m.user_id === group?.created_by)?.username;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={listItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <Text style={styles.groupName} numberOfLines={1} ellipsizeMode="tail">
                {group?.name}
              </Text>

              <Pressable
                onPress={handleCopyCode}
                accessibilityRole="button"
                accessibilityLabel="Copy join code"
                style={({ pressed }) => [styles.codeRow, pressed && styles.codeRowPressed]}
                hitSlop={4}
              >
                <Text style={styles.groupCode}>Code: {groupId}</Text>
                <Ionicons
                  name={copied ? 'checkmark' : 'copy-outline'}
                  size={16}
                  color={copied ? colors.mint : colors.textMuted}
                  style={styles.copyIcon}
                />
                <Text style={[styles.copyLabel, copied && styles.copyLabelDone]}>
                  {copied ? 'Copied' : 'Tap to copy'}
                </Text>
              </Pressable>

              <View style={styles.metaRow}>
                <Text style={styles.memberCount}>
                  <Text style={styles.memberCountNumber}>{members.length}</Text> members
                </Text>
                {creatorUsername ? (
                  <>
                    <Text style={styles.dot}>•</Text>
                    <Text style={styles.memberCount} numberOfLines={1} ellipsizeMode="tail">
                      Started by {handle(creatorUsername)}
                    </Text>
                  </>
                ) : null}
              </View>

              {isCreator ? (
                <View style={styles.pillsRow}>
                  <Pill label="Creator" tone="brand" size="sm" />
                </View>
              ) : null}
            </View>

            {error && group ? (
              <ErrorState compact title="Couldn't refresh" message={error.userMessage} onRetry={handleRefresh} style={styles.inlineError} />
            ) : null}

            {cashEnabled && (
              <View style={styles.walletCard}>
                <View style={styles.walletHeader}>
                  <View style={styles.walletTextCol}>
                    <Text style={styles.walletLabel}>Cash wallet</Text>
                    <Money amount={available} tone="neutral" size="lg" />
                  </View>
                  <Pressable style={styles.depositButtonWrap} onPress={handleDeposit} accessibilityRole="button" accessibilityLabel="Deposit funds">
                    <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.depositButton}>
                      <Ionicons name="card-outline" size={18} color={colors.white} />
                      <Text style={styles.depositButtonText}>Deposit</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              </View>
            )}

            <View style={styles.actionsRow}>
              <Pressable style={styles.actionButton} onPress={handleShareInvite} accessibilityRole="button" accessibilityLabel="Invite others">
                <Ionicons name="share-outline" size={20} color={colors.brand} />
                <Text style={styles.actionButtonText}>Invite</Text>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          events.length === 0 ? (
            <EmptyState
              icon="calendar-outline"
              title="No action yet"
              message="Create the first event to get this group betting."
              actionLabel="Create the first bet"
              onAction={handleCreateEvent}
              style={styles.emptyState}
            />
          ) : null
        }
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.brand} />}
        contentContainerStyle={events.length === 0 ? styles.emptyContentContainer : styles.listContent}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
      />

      <View style={styles.bottomBar}>
        <Button title="Create Event" onPress={handleCreateEvent} variant="primary" style={styles.bottomBarButton} icon="add-circle-outline" />
        {isCreator && (
          <Button title="Manage Group" onPress={handleManageGroup} variant="secondary" style={styles.bottomBarButton} icon="settings-outline" />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centerFill: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  skeletonBody: {
    padding: spacing.lg,
  },
  pendingContainer: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  pendingIconChip: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.amberFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  pendingTitle: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.xl,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  pendingText: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.base,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  pendingSubtext: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.textFaint,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  pendingButton: {
    minWidth: 160,
  },
  header: {
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  groupName: {
    fontFamily: font.display,
    fontSize: tokens.fontSize.xl,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    alignSelf: 'flex-start',
  },
  codeRowPressed: {
    opacity: 0.6,
  },
  groupCode: {
    fontFamily: font.monoMedium,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  copyIcon: {
    marginLeft: spacing.sm,
  },
  copyLabel: {
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
    marginLeft: spacing.xs,
  },
  copyLabelDone: {
    fontFamily: font.sansSemiBold,
    color: colors.mint,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.xs,
  },
  memberCount: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    flexShrink: 1,
  },
  memberCountNumber: {
    fontFamily: font.monoMedium,
    color: colors.text,
  },
  dot: {
    marginHorizontal: spacing.sm,
    color: colors.textFaint,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  inlineError: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.bg2,
    borderRadius: radius.lg,
  },
  walletCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  walletHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  walletTextCol: {
    flex: 1,
    minWidth: 0,
  },
  walletLabel: {
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  // Structured control — 8px radius, not a full pill (DESIGN-SPEC shape
  // language: pills are for people/state, never primary actions).
  depositButtonWrap: {
    borderRadius: radius.md,
    ...glow(colors.brand),
  },
  depositButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  depositButtonText: {
    fontFamily: font.sansSemiBold,
    color: colors.white,
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  actionButtonText: {
    fontFamily: font.sansSemiBold,
    color: colors.brand,
    fontSize: tokens.fontSize.sm,
  },
  sectionHeaderWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  eventCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  eventHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  eventTitle: {
    flex: 1,
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.base,
    color: colors.text,
  },
  eventFooterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  emptyState: {
    marginTop: spacing.xxl,
  },
  emptyContentContainer: {
    flexGrow: 1,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  bottomBar: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  bottomBarButton: {
    flex: 1,
  },
});
