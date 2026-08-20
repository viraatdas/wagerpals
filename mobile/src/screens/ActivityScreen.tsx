// Activity screen - Shows recent activity with modern iOS design
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ListRenderItemInfo,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { ActivityItem } from '../types';
import { EmptyState, ErrorState } from '../components/ScreenState';
import { SkeletonList } from '../components/Skeleton';
import { Avatar } from '../components/Avatar';
import { TitleText } from '../components/TitleText';
import { formatRelativeTime, formatMoney, handle } from '../utils/format';
import { ApiError, toApiError } from '../utils/errors';
import { tapLight } from '../utils/haptics';
import { colors, font, radius, spacing, tokens } from '../theme';

const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 88 : 64;
const PAGE_SIZE = 20;

function activityKey(item: ActivityItem, index: number): string {
  // ActivityItem has no unique id; the tuple below is as unique as the data
  // gets (a user can't log two identical actions on the same event at the
  // exact same millisecond), with `index` as a last-resort tiebreaker for
  // any theoretical collision — never used as the sole key.
  return `${item.type}-${item.event_id}-${item.user_id ?? ''}-${item.timestamp}-${index}`;
}

// Plain-text summary for the row's accessibilityLabel — the structured runs
// below (activityLine) are what actually render.
function getSentenceText(item: ActivityItem): string {
  const who = item.username ? handle(item.username) : 'Someone';
  switch (item.type) {
    case 'bet':
      return `${who} bet on ${item.side ?? 'a side'}`;
    case 'resolution':
      return item.winning_side ? `Settled, winner ${item.winning_side}` : 'Settled';
    case 'event_created':
      return `${who} started the bet`;
    case 'comment':
      return `${who} commented`;
    default:
      return 'Activity update';
  }
}

interface ActivityLine {
  primary: React.ReactNode;
  secondary?: string;
}

/** Row line 1: actor + verb, always in sans — actor semibold ink, verb
 * ink-secondary, and any named side/outcome in medium ink (emerald for a
 * settlement's winner). Mirrors app/activity/page.tsx's activityLine(). */
function activityLine(item: ActivityItem): ActivityLine {
  const who = item.username ? handle(item.username) : 'Someone';

  if (item.type === 'bet') {
    return {
      primary: (
        <Text style={styles.sentence} numberOfLines={1} ellipsizeMode="tail">
          <Text style={styles.sentenceActor}>{who}</Text>
          <Text style={styles.sentenceVerb}> bet on </Text>
          <Text style={styles.sentenceEmphasis}>{item.side ?? 'a side'}</Text>
        </Text>
      ),
      secondary: item.note,
    };
  }

  if (item.type === 'event_created') {
    return {
      primary: (
        <Text style={styles.sentence} numberOfLines={1} ellipsizeMode="tail">
          <Text style={styles.sentenceActor}>{who}</Text>
          <Text style={styles.sentenceVerb}> started the bet</Text>
        </Text>
      ),
    };
  }

  if (item.type === 'resolution') {
    return {
      primary: (
        <Text style={styles.sentence} numberOfLines={1} ellipsizeMode="tail">
          <Text style={styles.sentenceActor}>Settled</Text>
          {item.winning_side ? (
            <>
              <Text style={styles.sentenceVerb}> winner </Text>
              <Text style={styles.sentenceWin}>{item.winning_side}</Text>
            </>
          ) : null}
        </Text>
      ),
    };
  }

  if (item.type === 'comment') {
    return {
      primary: (
        <Text style={styles.sentence} numberOfLines={1} ellipsizeMode="tail">
          <Text style={styles.sentenceActor}>{who}</Text>
          <Text style={styles.sentenceVerb}> commented</Text>
        </Text>
      ),
      secondary: item.content || item.note,
    };
  }

  return {
    primary: (
      <Text style={styles.sentence} numberOfLines={1} ellipsizeMode="tail">
        Activity update
      </Text>
    ),
  };
}

interface ActivityRowProps {
  item: ActivityItem;
  onPress: (item: ActivityItem) => void;
}

const ActivityRow = React.memo(function ActivityRow({ item, onPress }: ActivityRowProps) {
  const { primary, secondary } = activityLine(item);
  // Settlement rows (and any row missing an actor) have no human to show —
  // a person avatar there reads as a mystery user, so they get a quiet
  // emerald check instead. Mirrors app/activity/page.tsx's isSystemRow.
  const isSystemRow = item.type === 'resolution' || !item.username;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={getSentenceText(item)}
      onPress={() => {
        tapLight();
        onPress(item);
      }}
      style={({ pressed }) => [styles.activityCardWrap, pressed && styles.activityCardPressed]}
    >
      <View style={styles.activityCard}>
        {isSystemRow ? (
          <View style={styles.checkBadge} importantForAccessibility="no-hide-descendants">
            <Ionicons name="checkmark" size={14} color={colors.mint} />
          </View>
        ) : (
          <Avatar username={item.username} size="md" style={styles.avatar} />
        )}
        <View style={styles.activityContent}>
          {primary}
          <View style={styles.titleRow}>
            <TitleText
              title={item.event_title}
              style={styles.eventTitle}
              numberOfLines={1}
              ellipsizeMode="tail"
            />
            {item.group_name ? (
              <Text style={styles.groupTag} numberOfLines={1} ellipsizeMode="tail">
                {item.group_name}
              </Text>
            ) : null}
          </View>
          {secondary ? (
            <Text style={styles.detail} numberOfLines={1} ellipsizeMode="tail">
              &ldquo;{secondary}&rdquo;
            </Text>
          ) : null}
        </View>
        <View style={styles.trailing}>
          {item.type === 'bet' && typeof item.amount === 'number' ? (
            <Text style={styles.amount}>{formatMoney(item.amount)}</Text>
          ) : null}
          <Text style={styles.activityTime}>{formatRelativeTime(item.timestamp)}</Text>
        </View>
      </View>
    </Pressable>
  );
});

export default function ActivityScreen() {
  const navigation = useNavigation<any>();
  const { user, isLoading: authLoading } = useAuth();
  const insets = useSafeAreaInsets();

  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const offsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const loadFirstPage = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user) {
      // Audit finding D8: clearing the loading flags here (rather than
      // returning before the try/finally) is what stops the spinner from
      // running forever for a signed-out user.
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
      // Audit finding D5: getActivity() now requires userId — the old
      // no-arg call always 400d, which is why this tab was permanently
      // empty. This is the fix.
      const data = await apiService.getActivity(user.id, { limit: PAGE_SIZE, offset: 0 });
      if (!mountedRef.current) return;
      setActivities(data);
      offsetRef.current = data.length;
      setHasMore(data.length === PAGE_SIZE);
      setLoadError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setLoadError(err instanceof ApiError ? err : toApiError(err, '/api/activity'));
    } finally {
      if (!mountedRef.current) return;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    setHasMore(true);
    // See apiService.invalidateForRefresh — the activity feed is SWR-cached
    // for 10s, so without this a pull inside that window replays the same
    // page and pagination restarts from identical data.
    apiService.invalidateForRefresh('/api/activity');
    loadFirstPage({ silent: true });
  }, [loadFirstPage]);

  const loadMore = useCallback(() => {
    if (!user || loadingMoreRef.current || !hasMore || isLoading || loadError) return;

    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    apiService
      .getActivity(user.id, { limit: PAGE_SIZE, offset: offsetRef.current })
      .then((data) => {
        if (!mountedRef.current) return;
        setActivities((prev) => [...prev, ...data]);
        offsetRef.current += data.length;
        setHasMore(data.length === PAGE_SIZE);
      })
      .catch(() => {
        // A failed page load stops pagination rather than retry-spamming on
        // every subsequent scroll frame; the rows already loaded stay put.
        // Pull-to-refresh starts a clean page 1 and re-enables pagination.
        if (!mountedRef.current) return;
        setHasMore(false);
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setIsLoadingMore(false);
        loadingMoreRef.current = false;
      });
  }, [user, hasMore, isLoading, loadError]);

  const handleActivityPress = useCallback((item: ActivityItem) => {
    navigation.navigate('EventDetail' as never, { eventId: item.event_id } as never);
  }, [navigation]);

  const renderActivityItem = useCallback(({ item }: ListRenderItemInfo<ActivityItem>) => (
    <ActivityRow item={item} onPress={handleActivityPress} />
  ), [handleActivityPress]);

  const keyExtractor = useCallback((item: ActivityItem, index: number) => activityKey(item, index), []);

  const listEmptyComponent = () => {
    if (!user) {
      return (
        <EmptyState
          icon="log-in-outline"
          title="Sign in required"
          message="Sign in to see history from your groups."
          style={styles.stateFill}
        />
      );
    }
    if (isLoading) {
      return <SkeletonList count={5} />;
    }
    if (loadError) {
      return (
        <ErrorState
          message={loadError.userMessage}
          onRetry={() => loadFirstPage()}
          style={styles.stateFill}
        />
      );
    }
    return (
      <EmptyState
        icon="pulse-outline"
        title="No action yet"
        message="Bets, comments and resolutions from your groups land here."
        style={styles.stateFill}
      />
    );
  };

  const listFooterComponent = () => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.footerLoading}>
        <ActivityIndicator size="small" color={colors.brand2} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>History</Text>
        <Text style={styles.headerSubtitle}>Recent updates from your groups</Text>
      </View>

      <FlatList
        data={activities}
        renderItem={renderActivityItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.list,
          { flexGrow: 1, paddingBottom: TAB_BAR_HEIGHT + insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={listEmptyComponent}
        ListFooterComponent={listFooterComponent}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brand2}
          />
        }
        initialNumToRender={8}
        windowSize={9}
        maxToRenderPerBatch={8}
        removeClippedSubviews
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: {
    fontFamily: font.display,
    fontSize: tokens.fontSize.xl,
    color: colors.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
  },
  list: {
    paddingHorizontal: 20,
  },
  stateFill: {
    flex: 1,
  },
  activityCardWrap: {
    marginBottom: 12,
    minHeight: 44,
  },
  activityCardPressed: {
    opacity: 0.7,
  },
  activityCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
  },
  avatar: {
    marginRight: 14,
    flexShrink: 0,
  },
  // Settlement (and other actor-less) rows get this instead of Avatar — a
  // small round emerald-tinted check, never a person's initial.
  checkBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.mintFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    marginTop: 6,
    flexShrink: 0,
  },
  activityContent: {
    flex: 1,
    minWidth: 0,
  },
  // Line 1 — actor + verb, sans.
  sentence: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.text,
    marginBottom: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  sentenceActor: {
    fontFamily: font.sansSemiBold,
    color: colors.text,
  },
  sentenceVerb: {
    fontFamily: font.sans,
    color: colors.textMuted,
  },
  sentenceEmphasis: {
    fontFamily: font.sansMedium,
    color: colors.text,
  },
  sentenceWin: {
    fontFamily: font.sansMedium,
    color: colors.mint,
  },
  // Line 2 — wager title (TitleText) + group name tag.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  eventTitle: {
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.sm,
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
  },
  groupTag: {
    fontFamily: font.mono,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    color: colors.textFaint,
    marginLeft: spacing.sm,
    flexShrink: 0,
  },
  // Optional line 3 — the quoted note/comment.
  detail: {
    fontFamily: font.sans,
    fontStyle: 'italic',
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
  },
  trailing: {
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    marginLeft: spacing.sm,
    flexShrink: 0,
    gap: 2,
  },
  amount: {
    fontFamily: font.monoMedium,
    fontSize: tokens.fontSize.sm,
    color: colors.text,
  },
  activityTime: {
    fontFamily: font.mono,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
  },
  footerLoading: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
