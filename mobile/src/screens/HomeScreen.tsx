// Home screen - Shows user's groups with modern iOS design
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
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
import { Group } from '../types';
import TextInputModal from '../components/TextInputModal';
import { EmptyState, ErrorState } from '../components/ScreenState';
import { SkeletonList } from '../components/Skeleton';
import { Card } from '../components/Card';
import { Pill } from '../components/Pill';
import { tapMedium, success, error as hapticError } from '../utils/haptics';
import { ApiError, toApiError } from '../utils/errors';
import { colors, gradients, radius, glow, spacing } from '../theme';
import { LinearGradient } from 'expo-linear-gradient';

// Matches the tab bar's own height (see navigation/MainTabNavigator.tsx) —
// the bar is absolutely positioned so scroll content needs explicit bottom
// clearance or the last row ends up hidden behind it.
const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 88 : 64;

interface GroupRowProps {
  item: Group;
  onPress: (item: Group) => void;
}

const GroupRow = React.memo(function GroupRow({ item, onPress }: GroupRowProps) {
  return (
    <Card onPress={() => onPress(item)} style={styles.groupCard}>
      <View style={styles.groupCardInner}>
        <View style={styles.groupIconContainer}>
          <Ionicons name="people" size={24} color={colors.brand2} />
        </View>
        <View style={styles.groupInfo}>
          <View style={styles.groupHeader}>
            <Text style={styles.groupName} numberOfLines={1} ellipsizeMode="tail">
              {item.name}
            </Text>
            {item.is_admin && <Pill label="Admin" tone="brand" size="sm" />}
          </View>
          <View style={styles.groupMeta}>
            <Text style={styles.groupCode} numberOfLines={1}>{item.id}</Text>
            <Text style={styles.groupDot}>•</Text>
            <Text style={styles.memberCount} numberOfLines={1}>
              {item.member_count ?? 0} member{item.member_count === 1 ? '' : 's'}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
      </View>
    </Card>
  );
});

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const { user, isLoading: authLoading } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const insets = useSafeAreaInsets();

  // Guards against setState-after-unmount from a fetch that resolves after
  // the screen has gone away.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // True once the first load (success or failure) has completed — used to
  // tell a "silent" background refetch-on-focus apart from the very first
  // load, so we only ever show the full-screen skeleton once.
  const hasLoadedRef = useRef(false);

  const loadGroups = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user) {
      // Audit finding D8: the old code `return`ed here BEFORE the try block,
      // so isLoading/isRefreshing were never cleared and the screen spun
      // forever for a signed-out (or still-resolving) user. Clear both here.
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
      const data = await apiService.getGroups(user.id);
      if (!mountedRef.current) return;
      setGroups(data);
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

  // Refetch on every focus (correct UX for a group list — membership/counts
  // can change from another screen), but keep it cheap: getGroups() opts
  // into the api layer's 15s SWR cache, so a rapid refocus is served from
  // cache instantly instead of firing a redundant network call. We only show
  // the loading skeleton for the very first load; later focuses refresh
  // silently so the list doesn't flash back to a skeleton every tab switch.
  useFocusEffect(
    useCallback(() => {
      if (authLoading) return;
      loadGroups({ silent: hasLoadedRef.current });
      hasLoadedRef.current = true;
    }, [authLoading, loadGroups])
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    // Without this the SWR cache answers the refetch from memory and the
    // pull gesture silently returns the same data. See invalidateForRefresh.
    apiService.invalidateForRefresh('/api/groups');
    loadGroups({ silent: true });
  }, [loadGroups]);

  const handleCreateGroup = useCallback(async (groupName: string) => {
    if (!user) return;

    setShowCreateModal(false);
    try {
      const newGroup = await apiService.createGroup(groupName, user.id);
      success();
      navigation.navigate('GroupDetail' as never, { groupId: newGroup.id } as never);
    } catch (err) {
      hapticError();
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups');
      Alert.alert('Error', apiErr.userMessage);
    }
  }, [user, navigation]);

  const handleJoinGroup = useCallback(async (groupCode: string) => {
    if (!user) return;

    setShowJoinModal(false);
    try {
      await apiService.joinGroup(groupCode.toUpperCase(), user.id);
      success();
      Alert.alert('Success', 'Join request submitted! Waiting for admin approval.');
      loadGroups({ silent: true });
    } catch (err) {
      hapticError();
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups');
      Alert.alert('Error', apiErr.userMessage);
    }
  }, [user, loadGroups]);

  const handleGroupPress = useCallback((item: Group) => {
    navigation.navigate('GroupDetail' as never, { groupId: item.id } as never);
  }, [navigation]);

  const renderGroupItem = useCallback(({ item }: ListRenderItemInfo<Group>) => (
    <GroupRow item={item} onPress={handleGroupPress} />
  ), [handleGroupPress]);

  const keyExtractor = useCallback((item: Group) => item.id, []);

  const listEmptyComponent = () => {
    if (!user) {
      return (
        <EmptyState
          icon="log-in-outline"
          title="Sign in required"
          message="Sign in to see the groups you're a part of."
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
          onRetry={() => loadGroups()}
          style={styles.stateFill}
        />
      );
    }
    return (
      <EmptyState
        icon="people-outline"
        title="No groups yet"
        message="Create a group or join one with a code to get started"
        actionLabel="Create a group"
        onAction={() => { tapMedium(); setShowCreateModal(true); }}
        style={styles.stateFill}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.welcomeText}>Welcome back</Text>
          <Text style={styles.titleText}>
            <Text style={styles.titleNormal}>Wager</Text>
            <Text style={styles.titleBold}>Pals</Text>
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('Profile' as never)}
          style={styles.profileButton}
          activeOpacity={0.7}
        >
          <View style={styles.profileAvatar}>
            <Ionicons name="person" size={20} color={colors.brand2} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Action Cards */}
      <View style={styles.actionCards}>
        <TouchableOpacity
          style={styles.actionCardWrap}
          onPress={() => { tapMedium(); setShowCreateModal(true); }}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={gradients.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.actionCard}
          >
            <View style={styles.actionIconContainer}>
              <Ionicons name="add" size={28} color={colors.white} />
            </View>
            <Text style={styles.actionTitle}>Create Group</Text>
            <Text style={styles.actionSubtitle}>Start a new betting group</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionCard, styles.actionCardAlt]}
          onPress={() => { tapMedium(); setShowJoinModal(true); }}
          activeOpacity={0.8}
        >
          <View style={[styles.actionIconContainer, styles.actionIconAlt]}>
            <Ionicons name="enter-outline" size={24} color={colors.brand2} />
          </View>
          <Text style={[styles.actionTitle, styles.actionTitleAlt]}>Join Group</Text>
          <Text style={[styles.actionSubtitle, styles.actionSubtitleAlt]}>Enter a group code</Text>
        </TouchableOpacity>
      </View>

      {/* Groups List */}
      <View style={styles.groupsSection}>
        <Text style={styles.sectionTitle}>Your Groups</Text>

        <FlatList
          data={groups}
          renderItem={renderGroupItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={[
            styles.groupsList,
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
          initialNumToRender={8}
          windowSize={7}
          maxToRenderPerBatch={8}
          removeClippedSubviews
        />
      </View>

      {/* Modals */}
      <TextInputModal
        visible={showCreateModal}
        title="Create Group"
        message="Enter a name for your new betting group"
        placeholder="Group name"
        onSubmit={handleCreateGroup}
        onCancel={() => setShowCreateModal(false)}
        submitText="Create"
      />

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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  welcomeText: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '400',
    marginBottom: 2,
  },
  titleText: {
    fontSize: 28,
  },
  titleNormal: {
    fontWeight: '300',
    color: colors.text,
  },
  titleBold: {
    fontWeight: '700',
    color: colors.brand2,
  },
  profileButton: {
    padding: 4,
  },
  profileAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandFill,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionCards: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 24,
  },
  actionCardWrap: {
    flex: 1,
    borderRadius: radius.lg,
    ...glow(colors.brand2, 0.45),
  },
  actionCard: {
    flex: 1,
    borderRadius: radius.lg,
    padding: 16,
    minHeight: 44,
  },
  actionCardAlt: {
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    minHeight: 44,
  },
  actionIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.brand3,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  actionIconAlt: {
    backgroundColor: colors.brandFill,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 4,
  },
  actionSubtitle: {
    fontSize: 12,
    color: colors.white,
    opacity: 0.85,
  },
  actionTitleAlt: {
    color: colors.text,
  },
  actionSubtitleAlt: {
    color: colors.textMuted,
    opacity: 1,
  },
  groupsSection: {
    flex: 1,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
  },
  groupsList: {
    paddingBottom: 20,
  },
  stateFill: {
    flex: 1,
  },
  groupCard: {
    marginBottom: 12,
  },
  groupCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.brandFill,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    flexShrink: 0,
  },
  groupInfo: {
    flex: 1,
    minWidth: 0,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
  },
  groupMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupCode: {
    fontSize: 13,
    color: colors.textFaint,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flexShrink: 1,
  },
  groupDot: {
    fontSize: 13,
    color: colors.textFaint,
    marginHorizontal: 6,
  },
  memberCount: {
    fontSize: 13,
    color: colors.textFaint,
    flexShrink: 0,
  },
});
