// Explore screen - Browse all events with modern iOS design
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ListRenderItemInfo,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import apiService from '../services/api';
import { Event } from '../types';
import { EmptyState, ErrorState } from '../components/ScreenState';
import { SkeletonList } from '../components/Skeleton';
import { Card } from '../components/Card';
import { Pill, PillTone } from '../components/Pill';
import { Money } from '../components/Money';
import { SplitBar } from '../components/ProgressBar';
import { formatCountdown, formatMoney } from '../utils/format';
import { ApiError, toApiError } from '../utils/errors';
import { colors, font, radius, spacing, tokens } from '../theme';

type FilterType = 'all' | 'active' | 'resolved';

const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 88 : 64;

// The list endpoint (GET /api/events) returns the same side_stats/total_bets
// aggregates as the single-event endpoint — see lib/db.ts getAllWithStats —
// but the shared `Event` type (owned by another agent) only declares the
// base event columns. Widen locally rather than editing that file.
type EventListItem = Event & {
  side_stats?: Record<string, { count: number; total: number }>;
  total_bets?: number;
  total_participants?: number;
};

function getStatusPill(item: EventListItem): { label: string; tone: PillTone } {
  if (item.status === 'resolved') {
    return { label: 'Resolved', tone: 'yes' };
  }
  const countdown = formatCountdown(item.end_time);
  if (countdown.isPast) {
    return { label: 'Ended', tone: 'no' };
  }
  return { label: countdown.label, tone: 'pending' };
}

interface EventCardProps {
  item: EventListItem;
  onPress: (item: EventListItem) => void;
}

const EventCard = React.memo(function EventCard({ item, onPress }: EventCardProps) {
  const statusPill = getStatusPill(item);
  const sideAStats = item.side_stats?.[item.side_a];
  const sideBStats = item.side_stats?.[item.side_b];
  const potTotal = (sideAStats?.total ?? 0) + (sideBStats?.total ?? 0);

  return (
    <Card onPress={() => onPress(item)} style={styles.eventCard}>
      <Text style={styles.eventTitle} numberOfLines={2} ellipsizeMode="tail">
        {item.title}
      </Text>

      <View style={styles.pillRow}>
        <Pill label={statusPill.label} tone={statusPill.tone} size="sm" />
        {item.payment_type === 'cash' && (
          <Pill
            label={formatMoney(item.stake_amount ?? 0)}
            tone="info"
            icon="cash-outline"
            size="sm"
          />
        )}
      </View>

      <View style={styles.splitWrap}>
        <SplitBar
          aValue={sideAStats?.total ?? 0}
          bValue={sideBStats?.total ?? 0}
          aLabel={item.side_a}
          bLabel={item.side_b}
        />
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.potLabel}>Pot</Text>
        <Money amount={potTotal} size="sm" tone="neutral" />
      </View>
    </Card>
  );
});

export default function ExploreScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const loadEvents = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoadError(null);
    }
    try {
      const data = await apiService.getEvents();
      if (!mountedRef.current) return;
      setEvents(data as EventListItem[]);
      setLoadError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setLoadError(err instanceof ApiError ? err : toApiError(err, '/api/events'));
    } finally {
      if (!mountedRef.current) return;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    // See apiService.invalidateForRefresh — without this the cached GET is
    // replayed and the pull gesture is a no-op.
    apiService.invalidateForRefresh('/api/events');
    loadEvents({ silent: true });
  }, [loadEvents]);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((event) => {
      if (filter !== 'all' && event.status !== filter) return false;
      if (query && !event.title.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [events, filter, search]);

  const getFilterCount = useCallback((filterType: FilterType) => {
    if (filterType === 'all') return events.length;
    return events.filter((e) => e.status === filterType).length;
  }, [events]);

  const handleEventPress = useCallback((item: EventListItem) => {
    navigation.navigate('EventDetail' as never, { eventId: item.id } as never);
  }, [navigation]);

  const renderEventCard = useCallback(({ item }: ListRenderItemInfo<EventListItem>) => (
    <EventCard item={item} onPress={handleEventPress} />
  ), [handleEventPress]);

  const keyExtractor = useCallback((item: EventListItem) => item.id, []);

  const listEmptyComponent = () => {
    if (isLoading) {
      return <SkeletonList count={4} />;
    }
    if (loadError) {
      return (
        <ErrorState
          message={loadError.userMessage}
          onRetry={() => loadEvents()}
          style={styles.stateFill}
        />
      );
    }
    return (
      <EmptyState
        icon="search-outline"
        title={search.trim() || filter !== 'all' ? 'No matches' : 'No action yet'}
        message={
          search.trim()
            ? `Nothing matches "${search.trim()}".`
            : filter !== 'all'
            ? `No ${filter} events right now.`
            : 'Create an event in one of your groups to start the first bet.'
        }
        style={styles.stateFill}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Explore</Text>
        <Text style={styles.headerSubtitle}>Browse all betting events</Text>
      </View>

      {/* Search — a plain header TextInput above the FlatList, not inside a
          KeyboardAvoidingView. The list scrolls independently underneath the
          keyboard so there's no avoidance interaction to get wrong. */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={colors.textFaint} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search events"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* Filter Pills */}
      <View style={styles.filterContainer}>
        {(['all', 'active', 'resolved'] as FilterType[]).map((filterType) => (
          <TouchableOpacity
            key={filterType}
            style={[styles.filterPill, filter === filterType && styles.filterPillActive]}
            onPress={() => setFilter(filterType)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterText, filter === filterType && styles.filterTextActive]}>
              {filterType.charAt(0).toUpperCase() + filterType.slice(1)}
            </Text>
            <View style={[styles.filterCount, filter === filterType && styles.filterCountActive]}>
              <Text style={[styles.filterCountText, filter === filterType && styles.filterCountTextActive]}>
                {getFilterCount(filterType)}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredEvents}
        renderItem={renderEventCard}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.list,
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.text,
    height: 44,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 16,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
    minHeight: 44,
  },
  filterPillActive: {
    backgroundColor: colors.brandFill,
    borderColor: colors.brand2,
  },
  filterText: {
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
  },
  filterTextActive: {
    color: colors.brand2,
  },
  filterCount: {
    backgroundColor: colors.bg2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  filterCountActive: {
    backgroundColor: colors.brandFill,
  },
  filterCountText: {
    fontFamily: font.monoMedium,
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
  },
  filterCountTextActive: {
    color: colors.brand2,
  },
  list: {
    paddingHorizontal: 20,
  },
  stateFill: {
    flex: 1,
  },
  eventCard: {
    marginBottom: 12,
  },
  eventTitle: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.lg,
    color: colors.text,
    lineHeight: 22,
    marginBottom: 10,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  splitWrap: {
    marginBottom: 14,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  potLabel: {
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
  },
});
