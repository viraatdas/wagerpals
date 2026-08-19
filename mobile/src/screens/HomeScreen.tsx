// Home screen — "The Board" (see DESIGN-SPEC.md / MOBILE-SPEC.md). A live
// list of wager cards across every group the user is in, not a
// dashboard-with-nav-tabs. Group navigation (create/join/open a group)
// stays reachable via the horizontal strip up top — nothing that used to be
// reachable from this screen has been removed, it's just no longer the
// entire screen.
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ScrollView,
  ListRenderItemInfo,
  Alert,
  RefreshControl,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { Event, Group } from '../types';
import TextInputModal from '../components/TextInputModal';
import { EmptyState, ErrorState } from '../components/ScreenState';
import { SkeletonList } from '../components/Skeleton';
import { Card } from '../components/Card';
import { Pill, PillTone } from '../components/Pill';
import { Avatar } from '../components/Avatar';
import { Money } from '../components/Money';
import { WAmount } from '../components/WMark';
import { SplitBar } from '../components/ProgressBar';
import { SectionHeader } from '../components/SectionHeader';
import { BottomSheet } from '../components/BottomSheet';
import { Field } from '../components/Field';
import { Toggle } from '../components/Toggle';
import { Button } from '../components/Button';
import { tapMedium, tapLight, success, error as hapticError } from '../utils/haptics';
import { ApiError, toApiError } from '../utils/errors';
import { truncate, handle } from '../utils/format';
import { colors, font, radius, spacing, tokens } from '../theme';

// Matches the tab bar's own height (see navigation/MainTabNavigator.tsx) —
// the bar is absolutely positioned so scroll content needs explicit bottom
// clearance or the last row ends up hidden behind it.
const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 88 : 64;

// The list endpoint (GET /api/events) returns the same side_stats/total_bets
// aggregates as the single-event endpoint, plus (per MOBILE-SPEC.md) optional
// bettor_preview/latest_comment batched onto the list query — but the shared
// `Event` type (owned by another agent) only declares the base event
// columns. Widen locally rather than editing that file, same pattern
// ExploreScreen already uses.
type EventBettorPreview = { username: string; avatar_url?: string; side: string };
type EventLatestComment = { username: string; content: string };
type WagerCardItem = Event & {
  side_stats?: Record<string, { count: number; total: number }>;
  total_bets?: number;
  total_participants?: number;
  bettor_preview?: EventBettorPreview[];
  latest_comment?: EventLatestComment;
};

// No-expiry status mapping: there is no countdown/closing concept anymore —
// an event is only ever 'active' ("Live") or 'resolved' ("Settled").
function getStatusPill(item: WagerCardItem): { label: string; tone: PillTone } {
  if (item.status === 'resolved') {
    return { label: 'Settled', tone: 'yes' };
  }
  return { label: 'Live', tone: 'brand' };
}

interface WagerCardProps {
  item: WagerCardItem;
  onPress: (item: WagerCardItem) => void;
}

// The wager card — web card anatomy, ported: avatars + title + status pill
// on top (sportsbook-crisp), the confidence bar as the signature element,
// then a warmer human row (a quoted comment when the payload has one, else
// a player count) below a hairline divider.
const WagerCard = React.memo(function WagerCard({ item, onPress }: WagerCardProps) {
  const statusPill = getStatusPill(item);
  const sideAStats = item.side_stats?.[item.side_a] ?? { count: 0, total: 0 };
  const sideBStats = item.side_stats?.[item.side_b] ?? { count: 0, total: 0 };
  const potTotal = sideAStats.total + sideBStats.total;
  const isCash = item.payment_type === 'cash';
  const previewBettors = item.bettor_preview?.slice(0, 3) ?? [];
  const betCount = item.total_bets ?? 0;

  return (
    <Card onPress={() => onPress(item)} style={styles.wagerCard}>
      <View style={styles.topRow}>
        {previewBettors.length > 0 ? (
          <View style={styles.avatarCluster}>
            {previewBettors.map((b, i) => (
              <Avatar
                key={`${b.username}-${i}`}
                username={b.username}
                size="sm"
                // Overlap only (no border override) — Avatar's own Amber
                // ring must stay intact, never overridden by a later style.
                style={i > 0 ? styles.avatarClusterOverlap : undefined}
              />
            ))}
          </View>
        ) : null}
        <Text style={styles.wagerTitle} numberOfLines={2} ellipsizeMode="tail">
          {item.title}
        </Text>
        <Pill label={statusPill.label} tone={statusPill.tone} size="sm" />
      </View>

      <View style={styles.oddsRow}>
        <View style={styles.oddsLineWrap}>
          <Text style={styles.oddsNumber} numberOfLines={1}>
            <Text style={styles.oddsNumberA}>{sideAStats.count}</Text>
            <Text style={styles.oddsColon}> : </Text>
            <Text style={styles.oddsNumberB}>{sideBStats.count}</Text>
          </Text>
        </View>
        <View style={styles.stakedWrap}>
          {isCash ? (
            <Money amount={potTotal} size="md" tone="neutral" />
          ) : (
            <WAmount value={potTotal} size="md" tone="neutral" />
          )}
          <Text style={styles.stakedLabel}>staked</Text>
        </View>
      </View>

      <SplitBar
        aValue={sideAStats.total}
        bValue={sideBStats.total}
        aLabel={truncate(item.side_a, 18)}
        bLabel={truncate(item.side_b, 18)}
      />

      <View style={styles.divider} />

      <View style={styles.humanRow}>
        {item.latest_comment ? (
          <Text style={styles.humanRowText} numberOfLines={1} ellipsizeMode="tail">
            <Text style={styles.humanRowQuote}>&ldquo;{truncate(item.latest_comment.content, 72)}&rdquo;</Text>
            <Text style={styles.humanRowAuthor}> &middot; {handle(truncate(item.latest_comment.username, 20))}</Text>
          </Text>
        ) : (
          <Text style={styles.humanRowText} numberOfLines={1}>
            {betCount} bet{betCount === 1 ? '' : 's'}
          </Text>
        )}
      </View>
    </Card>
  );
});

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const { user, isLoading: authLoading } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [wagers, setWagers] = useState<WagerCardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupCashEnabled, setNewGroupCashEnabled] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const insets = useSafeAreaInsets();

  // Guards against setState-after-unmount from a fetch that resolves after
  // the screen has gone away.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // True once the first load (success or failure) has completed — used to
  // tell a "silent" background refetch-on-focus apart from the very first
  // load, so we only ever show the full-screen skeleton once.
  const hasLoadedRef = useRef(false);

  const loadBoard = useCallback(async (opts?: { silent?: boolean }) => {
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
      const userGroups = await apiService.getGroups(user.id);
      if (!mountedRef.current) return;
      setGroups(userGroups);

      // The board aggregates every group's events client-side (there's no
      // single "my groups' wagers" endpoint) — one group's events failing to
      // load shouldn't blank the whole board, so each leg degrades to an
      // empty list on its own rather than rejecting the Promise.all.
      const eventLists = await Promise.all(
        userGroups.map((g) =>
          apiService.getEvents(g.id).catch((err) => {
            console.warn(`[Board] events for group ${g.id} failed to load:`, err);
            return [] as Event[];
          })
        )
      );
      if (!mountedRef.current) return;
      setWagers(eventLists.flat() as WagerCardItem[]);
      setLoadError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setLoadError(err instanceof ApiError ? err : toApiError(err, '/api/groups'));
    } finally {
      if (!mountedRef.current) return;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user]);

  // Refetch on every focus — membership, new wagers and bet totals can all
  // change from another screen. getGroups()/getEvents() both opt into the
  // api layer's SWR cache, so a rapid refocus is served from cache instead
  // of firing redundant network calls. We only show the loading skeleton for
  // the very first load; later focuses refresh silently.
  useFocusEffect(
    useCallback(() => {
      if (authLoading) return;
      loadBoard({ silent: hasLoadedRef.current });
      hasLoadedRef.current = true;
    }, [authLoading, loadBoard])
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    apiService.invalidateForRefresh('/api/groups', '/api/events');
    loadBoard({ silent: true });
  }, [loadBoard]);

  const closeCreateModal = useCallback(() => {
    setShowCreateModal(false);
    setNewGroupName('');
    setNewGroupCashEnabled(false);
  }, []);

  const handleCreateGroup = useCallback(async () => {
    if (!user || !newGroupName.trim() || isCreatingGroup) return;

    setIsCreatingGroup(true);
    try {
      const newGroup = await apiService.createGroup(newGroupName.trim(), user.id, newGroupCashEnabled);
      success();
      closeCreateModal();
      navigation.navigate('GroupDetail' as never, { groupId: newGroup.id } as never);
    } catch (err) {
      hapticError();
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups');
      Alert.alert("Couldn't create group", apiErr.userMessage);
    } finally {
      setIsCreatingGroup(false);
    }
  }, [user, newGroupName, newGroupCashEnabled, isCreatingGroup, navigation, closeCreateModal]);

  // Joins by code are instantly active now (flat-groups model) — no more
  // "waiting for admin approval" queue, so this drops straight into the
  // group instead of leaving the person on the board.
  const handleJoinGroup = useCallback(async (groupCode: string) => {
    if (!user) return;

    setShowJoinModal(false);
    try {
      await apiService.joinGroup(groupCode.toUpperCase(), user.id);
      success();
      loadBoard({ silent: true });
      navigation.navigate('GroupDetail' as never, { groupId: groupCode.toUpperCase() } as never);
    } catch (err) {
      hapticError();
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups');
      Alert.alert("Couldn't join group", apiErr.userMessage);
    }
  }, [user, loadBoard, navigation]);

  const handleGroupPress = useCallback((item: Group) => {
    navigation.navigate('GroupDetail' as never, { groupId: item.id } as never);
  }, [navigation]);

  const handleWagerPress = useCallback((item: WagerCardItem) => {
    navigation.navigate('EventDetail' as never, { eventId: item.id } as never);
  }, [navigation]);

  const handleStartFirstWager = useCallback(() => {
    if (groups.length === 1) {
      navigation.navigate('CreateEvent' as never, { groupId: groups[0].id } as never);
    }
  }, [groups, navigation]);

  // Active wagers lead the board (no-expiry rules mean there's no "soonest
  // to end" to sort by anymore — see the mobile product-rules brief), then
  // resolved ones, most recently decided first.
  const sortedWagers = useMemo(() => {
    const active = wagers.filter((w) => w.status === 'active');
    const resolved = wagers
      .filter((w) => w.status !== 'active')
      .sort((a, b) => (b.resolution?.resolved_at ?? 0) - (a.resolution?.resolved_at ?? 0));
    return [...active, ...resolved];
  }, [wagers]);

  const renderWagerCard = useCallback(({ item }: ListRenderItemInfo<WagerCardItem>) => (
    <WagerCard item={item} onPress={handleWagerPress} />
  ), [handleWagerPress]);

  const keyExtractor = useCallback((item: WagerCardItem) => item.id, []);

  const listHeaderComponent = (
    <View>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.welcomeText}>Welcome back</Text>
          <Text style={styles.titleText}>
            <Text style={styles.titleWordmark}>Wager</Text>
            <Text style={[styles.titleWordmark, styles.titleWordmarkAccent]}>Pals</Text>
          </Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate('Profile' as never)}
          style={styles.profileButton}
          accessibilityRole="button"
          accessibilityLabel="Profile"
        >
          <View style={styles.profileAvatar}>
            <Ionicons name="person" size={20} color={colors.brand2} />
          </View>
        </Pressable>
      </View>

      {/* Group affordances — open a group, create one, or join one with a
          code. This is everything the old full-screen groups list did,
          just compacted into a strip so the board can lead above the fold. */}
      {user ? (
        <View style={styles.groupStripSection}>
          <SectionHeader title="Your groups" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.groupStrip}
          >
            {groups.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => handleGroupPress(g)}
                style={styles.groupChip}
                accessibilityRole="button"
                accessibilityLabel={`${g.name}, ${g.member_count ?? 0} members`}
              >
                <Avatar username={g.name} size="md" />
                <Text style={styles.groupChipLabel} numberOfLines={1}>
                  {g.name}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => { tapMedium(); setShowCreateModal(true); }}
              style={styles.groupChip}
              accessibilityRole="button"
              accessibilityLabel="Create a group"
            >
              <View style={styles.groupChipActionCircle}>
                <Ionicons name="add" size={20} color={colors.brand} />
              </View>
              <Text style={styles.groupChipLabel} numberOfLines={1}>New</Text>
            </Pressable>
            <Pressable
              onPress={() => { tapLight(); setShowJoinModal(true); }}
              style={styles.groupChip}
              accessibilityRole="button"
              accessibilityLabel="Join a group with a code"
            >
              <View style={styles.groupChipActionCircle}>
                <Ionicons name="enter-outline" size={20} color={colors.brand} />
              </View>
              <Text style={styles.groupChipLabel} numberOfLines={1}>Join</Text>
            </Pressable>
          </ScrollView>
        </View>
      ) : null}

      {!isLoading && !loadError && groups.length > 0 ? (
        <View style={styles.boardHeaderRow}>
          <SectionHeader title="Live wagers" />
        </View>
      ) : null}
    </View>
  );

  const listEmptyComponent = () => {
    if (!user) {
      return (
        <EmptyState
          icon="log-in-outline"
          title="Sign in required"
          message="Sign in to see the wagers your groups are running."
          style={styles.stateFill}
        />
      );
    }
    if (isLoading) {
      return <SkeletonList count={4} />;
    }
    if (loadError) {
      return (
        <ErrorState
          message={loadError.userMessage}
          onRetry={() => loadBoard()}
          style={styles.stateFill}
        />
      );
    }
    if (groups.length === 0) {
      return (
        <EmptyState
          icon="people-outline"
          title="No groups yet"
          message="Create a group or join one with a code to get started."
          actionLabel="Create a group"
          onAction={() => { tapMedium(); setShowCreateModal(true); }}
          style={styles.stateFill}
        />
      );
    }
    // The blank-betting-slip idiom (DESIGN-SPEC.md) — same card shape as a
    // real wager, dashed border, ghosted odds, product voice.
    return (
      <EmptyState
        icon="cash-outline"
        title="No action yet"
        message="Start the first bet."
        actionLabel={groups.length === 1 ? 'Start a wager' : undefined}
        onAction={groups.length === 1 ? handleStartFirstWager : undefined}
        style={styles.stateFill}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />

      <FlatList
        data={sortedWagers}
        renderItem={renderWagerCard}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeaderComponent}
        contentContainerStyle={[
          styles.listContent,
          { flexGrow: 1, paddingBottom: TAB_BAR_HEIGHT + insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={listEmptyComponent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brand2}
          />
        }
        initialNumToRender={6}
        windowSize={7}
        maxToRenderPerBatch={6}
        removeClippedSubviews
      />

      {/* Modals */}
      <BottomSheet visible={showCreateModal} onClose={closeCreateModal} title="Create group" snapToContent>
        <Field
          label="Group name"
          value={newGroupName}
          onChangeText={setNewGroupName}
          placeholder="e.g. Sunday Football"
          returnKeyType="done"
          autoCorrect={false}
        />
        <Toggle
          label="Cash wagers"
          description="Members can stake real money from their wallets."
          value={newGroupCashEnabled}
          onValueChange={setNewGroupCashEnabled}
        />
        <Button
          title="Create"
          onPress={handleCreateGroup}
          variant="primary"
          fullWidth
          loading={isCreatingGroup}
          disabled={!newGroupName.trim() || isCreatingGroup}
          style={styles.createGroupButton}
        />
      </BottomSheet>

      <TextInputModal
        visible={showJoinModal}
        title="Join Group"
        message="Enter the 6-character group code"
        placeholder="ABC123"
        maxLength={6}
        onSubmit={handleJoinGroup}
        onCancel={() => setShowJoinModal(false)}
        submitText="Join"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  createGroupButton: {
    marginTop: spacing.md,
  },
  stateFill: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  welcomeText: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    marginBottom: 2,
  },
  titleText: {
    fontSize: tokens.fontSize['2xl'],
  },
  // Archivo Black only, per DESIGN-SPEC.md's type system — no bold/light
  // variants of a display font, so "Pals" is set apart with color instead.
  titleWordmark: {
    fontFamily: font.display,
    color: colors.text,
  },
  titleWordmarkAccent: {
    color: tokens.color.emerald,
  },
  profileButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brandFill,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Group strip
  groupStripSection: {
    marginBottom: spacing.lg,
  },
  groupStrip: {
    gap: spacing.lg,
    paddingRight: spacing.md,
  },
  groupChip: {
    alignItems: 'center',
    width: 64,
  },
  groupChipActionCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupChipLabel: {
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },

  boardHeaderRow: {
    marginBottom: spacing.xs,
  },

  // Wager card
  wagerCard: {
    marginBottom: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  avatarCluster: {
    flexDirection: 'row',
    flexShrink: 0,
  },
  avatarClusterOverlap: {
    marginLeft: -12,
  },
  wagerTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.base,
    color: colors.text,
    lineHeight: tokens.lineHeight.base,
  },
  oddsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  oddsLineWrap: {
    flexShrink: 1,
  },
  oddsNumber: {
    fontFamily: font.monoMedium,
    fontSize: tokens.fontSize['3xl'],
  },
  oddsNumberA: {
    color: tokens.color.emerald,
  },
  oddsColon: {
    color: colors.textFaint,
  },
  oddsNumberB: {
    color: tokens.color.crimson,
  },
  stakedWrap: {
    alignItems: 'flex-end',
  },
  stakedLabel: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  humanRow: {
    minHeight: 20,
  },
  humanRowText: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
  },
  humanRowQuote: {
    fontFamily: font.sans,
    fontStyle: 'italic',
    color: colors.text,
  },
  humanRowAuthor: {
    fontFamily: font.sansMedium,
    color: tokens.color.amberInk,
  },
});
