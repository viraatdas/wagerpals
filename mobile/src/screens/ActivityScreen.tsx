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
import { formatRelativeTime, formatMoney } from '../utils/format';
import { ApiError, toApiError } from '../utils/errors';
import { tapLight } from '../utils/haptics';
import { colors, radius, spacing } from '../theme';

const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 88 : 64;
const PAGE_SIZE = 20;

function activityKey(item: ActivityItem, index: number): string {
  // ActivityItem has no unique id; the tuple below is as unique as the data
  // gets (a user can't log two identical actions on the same event at the
  // exact same millisecond), with `index` as a last-resort tiebreaker for
  // any theoretical collision — never used as the sole key.
  return `${item.type}-${item.event_id}-${item.user_id ?? ''}-${item.timestamp}-${index}`;
}

function getActivityIcon(type: ActivityItem['type']): { name: keyof typeof Ionicons.glyphMap; color: string; bg: string } {
  switch (type) {
    case 'bet':
      return { name: 'cash-outline', color: colors.cyan, bg: colors.cyanFill };
    case 'resolution':
      return { name: 'trophy-outline', color: colors.mint, bg: colors.mintFill };
    case 'event_created':
      return { name: 'add-circle-outline', color: colors.violet, bg: colors.violetFill };
    case 'comment':
      return { name: 'chatbubble-outline', color: colors.amber, bg: colors.amberFill };
    default:
      return { name: 'ellipse', color: colors.textMuted, bg: colors.surfaceGlass };
  }
}

function getSentence(item: ActivityItem): string {
  const who = item.username || 'Someone';
  switch (item.type) {
    case 'bet':
      return `${who} bet ${formatMoney(item.amount ?? 0)} on ${item.side ?? 'a side'}`;
    case 'resolution':
      return item.winning_side ? `${item.winning_side} won — event resolved` : 'Event resolved';
    case 'event_created':
      return `${who} created a new event`;
    case 'comment':
      return `${who} commented`;
    default:
      return 'Activity update';
  }
}

function getDetail(item: ActivityItem): string | undefined {
  if (item.type === 'bet') return item.note;
  if (item.type === 'comment') return item.content;
  return undefined;
}

interface ActivityRowProps {
  item: ActivityItem;
  onPress: (item: ActivityItem) => void;
}

const ActivityRow = React.memo(function ActivityRow({ item, onPress }: ActivityRowProps) {
  const icon = getActivityIcon(item.type);
  const detail = getDetail(item);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={getSentence(item)}
      onPress={() => {
        tapLight();
        onPress(item);
      }}
      style={({ pressed }) => [styles.activityCardWrap, pressed && styles.activityCardPressed]}
    >
      <View style={styles.activityCard}>
        <Avatar username={item.username} size="md" style={styles.avatar} />
        <View style={styles.activityContent}>
          <View style={styles.sentenceRow}>
            <Ionicons name={icon.name} size={13} color={icon.color} style={styles.sentenceIcon} />
            <Text style={styles.sentence} numberOfLines={1} ellipsizeMode="tail">
              {getSentence(item)}
            </Text>
          </View>
          {detail ? (
            <Text style={styles.detail} numberOfLines={2} ellipsizeMode="tail">
              "{detail}"
            </Text>
          ) : null}
          <View style={styles.activityMeta}>
            <Text style={styles.eventTitle} numberOfLines={1} ellipsizeMode="tail">
              {item.event_title}
            </Text>
            {item.group_name ? (
              <>
                <Text style={styles.metaDot}>•</Text>
                <Text style={styles.groupName} numberOfLines={1} ellipsizeMode="tail">
                  {item.group_name}
                </Text>
              </>
            ) : null}
          </View>
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
          message="Sign in to see activity from your groups."
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
        title="No activity yet"
        message="Activity from your groups will appear here"
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
        <Text style={styles.headerTitle}>Activity</Text>
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
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
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
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
  },
  avatar: {
    marginRight: 14,
    flexShrink: 0,
  },
  activityContent: {
    flex: 1,
    minWidth: 0,
  },
  sentenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  sentenceIcon: {
    marginRight: 6,
    flexShrink: 0,
  },
  sentence: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
  },
  detail: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: 6,
  },
  activityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  eventTitle: {
    fontSize: 12,
    color: colors.brand2,
    fontWeight: '500',
    flexShrink: 1,
    minWidth: 0,
  },
  metaDot: {
    fontSize: 12,
    color: colors.textFaint,
    marginHorizontal: 6,
    flexShrink: 0,
  },
  groupName: {
    fontSize: 12,
    color: colors.textFaint,
    flexShrink: 1,
    minWidth: 0,
  },
  activityTime: {
    fontSize: 12,
    color: colors.textFaint,
  },
  footerLoading: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
