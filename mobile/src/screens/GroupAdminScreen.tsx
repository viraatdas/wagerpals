// Group Admin Screen - Manage members, group settings, and danger zone.
// A single SectionList (not a ScrollView full of .map()s) renders the
// member rows; settings live in the header, danger zone in the footer.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { Group, GroupMember } from '../types';
import { ApiError, toApiError } from '../utils/errors';
import { tapHeavy, tapMedium, success, warning, error as hapticError } from '../utils/haptics';
import { colors, radius, spacing, tokens } from '../theme';
import { Avatar, Button, Card, EmptyState, ErrorState, Pill, SectionHeader, Skeleton, SkeletonList, Toggle } from '../components';

type GroupData = Group & { members?: GroupMember[]; pending_requests?: GroupMember[] };
type MemberAction = 'approve' | 'decline' | 'promote' | 'demote' | 'remove';
type SectionKey = 'pending' | 'admins' | 'members';

interface MemberSection {
  key: SectionKey;
  title: string;
  data: GroupMember[];
}

const ACTION_CONFIG: Record<
  MemberAction,
  { title: string; message: (username: string) => string; confirmLabel: string; destructive: boolean; failTitle: string }
> = {
  approve: {
    title: 'Approve request',
    message: (u) => `Approve ${u}'s request to join?`,
    confirmLabel: 'Approve',
    destructive: false,
    failTitle: "Couldn't approve request",
  },
  decline: {
    title: 'Decline request',
    message: (u) => `Decline ${u}'s request to join? They can request to join again later.`,
    confirmLabel: 'Decline',
    destructive: true,
    failTitle: "Couldn't decline request",
  },
  promote: {
    title: 'Promote to admin',
    message: (u) => `Make ${u} an admin? They'll be able to manage members and group settings.`,
    confirmLabel: 'Promote',
    destructive: false,
    failTitle: "Couldn't promote member",
  },
  demote: {
    title: 'Remove admin access',
    message: (u) => `Remove admin access from ${u}? They'll remain a regular member.`,
    confirmLabel: 'Demote',
    destructive: true,
    failTitle: "Couldn't demote admin",
  },
  remove: {
    title: 'Remove member',
    message: (u) => `Remove ${u} from the group? They'll need to request to join again.`,
    confirmLabel: 'Remove',
    destructive: true,
    failTitle: "Couldn't remove member",
  },
};

function applyMemberAction(list: GroupMember[], action: MemberAction, targetUserId: string): GroupMember[] {
  switch (action) {
    case 'approve':
      return list.map((m) => (m.user_id === targetUserId ? { ...m, status: 'active' as const } : m));
    case 'decline':
    case 'remove':
      return list.filter((m) => m.user_id !== targetUserId);
    case 'promote':
      return list.map((m) => (m.user_id === targetUserId ? { ...m, role: 'admin' as const } : m));
    case 'demote':
      return list.map((m) => (m.user_id === targetUserId ? { ...m, role: 'member' as const } : m));
    default:
      return list;
  }
}

export default function GroupAdminScreen() {
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { groupId } = route.params as { groupId: string };

  const [group, setGroup] = useState<GroupData | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [rowBusy, setRowBusy] = useState<Record<string, MemberAction | undefined>>({});
  const [resolverUpdating, setResolverUpdating] = useState<string | null>(null);
  const [isTogglingVisibility, setIsTogglingVisibility] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = useCallback(
    async (opts?: { isRefresh?: boolean }) => {
      if (!user) {
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (opts?.isRefresh) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);

      try {
        const [groupData, membersData] = await Promise.all([
          apiService.getGroup(groupId),
          apiService.getGroupMembers(groupId),
        ]);
        setGroup(groupData);
        setMembers(membersData);
      } catch (err) {
        setError(err instanceof ApiError ? err : toApiError(err, '/api/groups'));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [groupId, user]
  );

  useFocusEffect(
    useCallback(() => {
      loadData().catch(() => {});
    }, [loadData])
  );

  const handleRefresh = useCallback(() => {
    // See apiService.invalidateForRefresh — admins pull specifically to see
    // whether a new join request landed, so serving this from cache is the
    // worst possible place to do it.
    apiService.invalidateForRefresh('/api/groups');
    loadData({ isRefresh: true }).catch(() => {});
  }, [loadData]);

  const viewerIsAdmin = useMemo(
    () => members.some((m) => m.user_id === user?.id && m.role === 'admin' && m.status === 'active'),
    [members, user?.id]
  );

  const sections = useMemo<MemberSection[]>(() => {
    const pending = members.filter((m) => m.status === 'pending');
    const active = members.filter((m) => m.status === 'active');
    const admins = active.filter((m) => m.role === 'admin');
    const regular = active.filter((m) => m.role === 'member');

    const result: MemberSection[] = [];
    if (pending.length > 0) {
      result.push({ key: 'pending', title: `Pending Requests (${pending.length})`, data: pending });
    }
    result.push({ key: 'admins', title: `Admins (${admins.length})`, data: admins });
    result.push({ key: 'members', title: `Members (${regular.length})`, data: regular });
    return result;
  }, [members]);

  const runMemberAction = useCallback(
    async (action: MemberAction, targetUserId: string, username: string) => {
      if (!user || rowBusy[targetUserId]) return;

      const previousMembers = members;
      const config = ACTION_CONFIG[action];

      setRowBusy((prev) => ({ ...prev, [targetUserId]: action }));
      setMembers((prev) => applyMemberAction(prev, action, targetUserId));

      try {
        await apiService.manageGroupMember(action, groupId, user.id, targetUserId);
        success();
      } catch (err) {
        setMembers(previousMembers);
        const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups/members');
        hapticError();
        Alert.alert(config.failTitle, apiErr.userMessage);
      } finally {
        setRowBusy((prev) => {
          const next = { ...prev };
          delete next[targetUserId];
          return next;
        });
      }
    },
    [groupId, members, rowBusy, user]
  );

  const handleMemberAction = useCallback(
    (action: MemberAction, targetUserId: string, username: string) => {
      const label = username || 'this member';
      const config = ACTION_CONFIG[action];

      if (!config.destructive) {
        tapMedium();
        void runMemberAction(action, targetUserId, label);
        return;
      }

      Alert.alert(config.title, config.message(label), [
        { text: 'Cancel', style: 'cancel' },
        {
          text: config.confirmLabel,
          style: 'destructive',
          onPress: () => {
            tapHeavy();
            void runMemberAction(action, targetUserId, label);
          },
        },
      ]);
    },
    [runMemberAction]
  );

  const runResolverChange = useCallback(
    async (member: GroupMember) => {
      if (resolverUpdating) return;
      setResolverUpdating(member.user_id);
      try {
        const updated = await apiService.updateGroupSettings({ id: groupId, resolver_user_id: member.user_id });
        setGroup((prev) => (prev ? { ...prev, ...updated } : (updated as GroupData)));
        success();
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups');
        hapticError();
        Alert.alert("Couldn't set resolver", apiErr.userMessage);
      } finally {
        setResolverUpdating(null);
      }
    },
    [groupId, resolverUpdating]
  );

  const handleResolverChange = useCallback(
    (member: GroupMember) => {
      if (!group || member.user_id === group.resolver_user_id || resolverUpdating) return;
      const label = member.username || 'this member';
      Alert.alert('Set Resolver', `Make ${label} the resolver for paid events? They'll decide the outcome of cash bets.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Set Resolver', onPress: () => void runResolverChange(member) },
      ]);
    },
    [group, resolverUpdating, runResolverChange]
  );

  const runVisibilityToggle = useCallback(
    async (nextIsPublic: boolean) => {
      if (!group || isTogglingVisibility) return;
      warning();
      setIsTogglingVisibility(true);
      try {
        const updated = await apiService.updateGroupSettings({ id: groupId, is_public: nextIsPublic });
        setGroup((prev) => (prev ? { ...prev, ...updated } : (updated as GroupData)));
        success();
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups');
        hapticError();
        Alert.alert("Couldn't update group", apiErr.userMessage);
      } finally {
        setIsTogglingVisibility(false);
      }
    },
    [group, groupId, isTogglingVisibility]
  );

  // Audit finding B7: is_public isn't just a visibility flag — it decides
  // whether open bets are settled in points or real cash. Flipping it
  // retroactively changes the currency of every open bet in the group, so
  // the confirm copy has to say that explicitly, not just "are you sure?".
  const handleVisibilityToggle = useCallback(
    (nextIsPublic: boolean) => {
      if (!group) return;
      const title = nextIsPublic ? 'Switch to free points?' : 'Switch to paid wallet betting?';
      const message = nextIsPublic
        ? 'Every open bet in this group is currently backed by real money held in the group wallet. Switching to free points retroactively converts those open bets to points — the currency they settle in changes for everyone, right now. This cannot be undone automatically.'
        : 'Switching to paid wallet betting retroactively converts every open bet in this group from free points to real money, and new bets will move funds through the group wallet. This cannot be undone automatically.';

      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', style: 'destructive', onPress: () => void runVisibilityToggle(nextIsPublic) },
      ]);
    },
    [group, runVisibilityToggle]
  );

  const runDeleteGroup = useCallback(async () => {
    if (isDeleting) return;
    tapHeavy();
    setIsDeleting(true);
    try {
      await apiService.deleteGroup(groupId);
      success();
      // 'Home' is a tab screen inside the `Main` tab navigator, not a
      // root-stack route — this screen sits in the root stack, so a bare
      // navigation.navigate('Home') is not handled by any navigator and
      // silently no-ops, leaving the (now-deleted) group screen on screen.
      // Target the tab explicitly through its parent stack screen instead.
      navigation.navigate('Main' as never, { screen: 'Home' } as never);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups');
      hapticError();
      Alert.alert("Couldn't delete group", apiErr.userMessage);
    } finally {
      setIsDeleting(false);
    }
  }, [groupId, isDeleting, navigation]);

  const handleDeleteGroup = useCallback(() => {
    if (!group) return;
    Alert.alert(
      'Delete Group',
      `This permanently deletes "${group.name}" and all of its events, bets, and history for every member. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void runDeleteGroup() },
      ]
    );
  }, [group, runDeleteGroup]);

  // ---- Initial load: skeleton matching the real content shape ----
  if (isLoading && !group) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.skeletonBody}>
          <Skeleton width="55%" height={20} style={{ marginBottom: spacing.md }} />
          <Skeleton width="100%" height={80} radius={radius.lg} style={{ marginBottom: spacing.xl }} />
          <SkeletonList count={4} />
        </View>
      </SafeAreaView>
    );
  }

  // ---- Initial-load failure: nothing cached, full-screen error ----
  if (error && !group) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <SectionList
          sections={[]}
          renderItem={() => null}
          keyExtractor={() => 'noop'}
          ListEmptyComponent={<ErrorState message={error.userMessage} onRetry={handleRefresh} />}
          contentContainerStyle={styles.emptyContentContainer}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.brand} />}
        />
      </SafeAreaView>
    );
  }

  // ---- Loaded, but the signed-in user isn't an admin: nothing to manage here ----
  if (group && !viewerIsAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <SectionList
          sections={[]}
          renderItem={() => null}
          keyExtractor={() => 'noop'}
          ListEmptyComponent={
            <ErrorState
              title="Admins only"
              message="You don't have permission to manage this group."
              onRetry={handleRefresh}
              retryLabel="Refresh"
            />
          }
          contentContainerStyle={styles.emptyContentContainer}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.brand} />}
        />
      </SafeAreaView>
    );
  }

  const activeMembers = members.filter((m) => m.status === 'active');
  const isCreator = !!user && !!group && user.id === group.created_by;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.user_id}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.brand} />}
        contentContainerStyle={styles.listContent}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          <View>
            {error && group ? (
              <ErrorState compact title="Couldn't refresh" message={error.userMessage} onRetry={handleRefresh} style={styles.inlineError} />
            ) : null}

            <View style={styles.section}>
              <SectionHeader title="Group Settings" />
              <Card>
                <Toggle
                  label="Free points mode"
                  description={
                    group?.is_public
                      ? 'Bets settle in free points, not real money.'
                      : 'Bets move real money through the group wallet.'
                  }
                  value={!!group?.is_public}
                  onValueChange={handleVisibilityToggle}
                  disabled={isTogglingVisibility}
                />

                {!group?.is_public && (
                  <View style={styles.resolverBlock}>
                    <Text style={styles.resolverLabel}>
                      Resolver: {group?.resolver?.username ? `@${group.resolver.username}` : 'Not set'}
                    </Text>
                    <View style={styles.resolverList}>
                      {activeMembers.map((member) => {
                        const selected = group?.resolver_user_id === member.user_id;
                        const busy = resolverUpdating === member.user_id;
                        return (
                          <Pressable
                            key={member.user_id}
                            style={[styles.resolverChip, selected && styles.resolverChipSelected]}
                            onPress={() => handleResolverChange(member)}
                            disabled={!!resolverUpdating}
                            accessibilityRole="button"
                            accessibilityLabel={`Set @${member.username || 'member'} as resolver`}
                          >
                            <Text
                              style={[styles.resolverChipText, selected && styles.resolverChipTextSelected]}
                              numberOfLines={1}
                              ellipsizeMode="tail"
                            >
                              {busy ? 'Setting…' : `@${member.username || 'member'}`}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}
              </Card>
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => {
          if (section.key === 'pending') {
            return (
              <View style={styles.pendingHeaderWrap}>
                <Ionicons name="person-add-outline" size={16} color={colors.amber} />
                <Text style={styles.pendingHeaderText}>{section.title}</Text>
              </View>
            );
          }
          return (
            <View style={styles.sectionHeaderWrap}>
              <SectionHeader title={section.title} />
            </View>
          );
        }}
        renderItem={({ item, section }) => {
          const busyAction = rowBusy[item.user_id];
          const isBusy = !!busyAction;
          const username = item.username || 'Unknown';
          const isSelf = item.user_id === user?.id;

          if (section.key === 'pending') {
            return (
              <View style={styles.memberRow}>
                <Avatar username={item.username} size="md" />
                <View style={styles.memberTextCol}>
                  <Text style={styles.memberName} numberOfLines={1} ellipsizeMode="tail">
                    {username}
                  </Text>
                  <Text style={styles.memberSubtext}>Waiting for approval</Text>
                </View>
                <View style={styles.rowActions}>
                  <Button
                    title="Approve"
                    size="sm"
                    variant="primary"
                    icon="checkmark"
                    loading={busyAction === 'approve'}
                    disabled={isBusy}
                    onPress={() => handleMemberAction('approve', item.user_id, username)}
                  />
                  <Button
                    title="Decline"
                    size="sm"
                    variant="danger"
                    icon="close"
                    loading={busyAction === 'decline'}
                    disabled={isBusy}
                    onPress={() => handleMemberAction('decline', item.user_id, username)}
                  />
                </View>
              </View>
            );
          }

          if (section.key === 'admins') {
            return (
              <View style={styles.memberRow}>
                <Avatar username={item.username} size="md" />
                <View style={styles.memberTextCol}>
                  <Text style={styles.memberName} numberOfLines={1} ellipsizeMode="tail">
                    {username}
                  </Text>
                  <Pill label="Admin" tone="brand" size="sm" />
                </View>
                {!isSelf && (
                  <View style={styles.rowActions}>
                    <Button
                      title="Demote"
                      size="sm"
                      variant="secondary"
                      loading={busyAction === 'demote'}
                      disabled={isBusy}
                      onPress={() => handleMemberAction('demote', item.user_id, username)}
                    />
                  </View>
                )}
              </View>
            );
          }

          return (
            <View style={styles.memberRow}>
              <Avatar username={item.username} size="md" />
              <View style={styles.memberTextCol}>
                <Text style={styles.memberName} numberOfLines={1} ellipsizeMode="tail">
                  {username}
                </Text>
                <Pill label="Member" tone="neutral" size="sm" />
              </View>
              <View style={styles.rowActions}>
                <Button
                  title="Promote"
                  size="sm"
                  variant="primary"
                  loading={busyAction === 'promote'}
                  disabled={isBusy}
                  onPress={() => handleMemberAction('promote', item.user_id, username)}
                />
                <Button
                  title="Remove"
                  size="sm"
                  variant="danger"
                  icon="trash-outline"
                  loading={busyAction === 'remove'}
                  disabled={isBusy}
                  onPress={() => handleMemberAction('remove', item.user_id, username)}
                />
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          members.length === 0 ? (
            <EmptyState icon="people-outline" title="No members found" message="Pull to refresh to try loading members again." style={styles.emptyState} />
          ) : null
        }
        ListFooterComponent={
          isCreator ? (
            <View style={styles.section}>
              <SectionHeader title="Danger Zone" />
              <Button
                title="Delete Group"
                variant="danger"
                icon="trash-outline"
                fullWidth
                loading={isDeleting}
                disabled={isDeleting}
                onPress={handleDeleteGroup}
              />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  skeletonBody: {
    padding: spacing.lg,
  },
  emptyContentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyState: {
    marginTop: spacing.xl,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  inlineError: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.bg2,
    borderRadius: radius.lg,
  },
  section: {
    padding: spacing.lg,
  },
  resolverBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  resolverLabel: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  resolverList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  resolverChip: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceGlass,
    maxWidth: '100%',
  },
  resolverChipSelected: {
    backgroundColor: colors.mintFill,
    borderColor: colors.mint,
  },
  resolverChipText: {
    color: colors.textMuted,
    fontSize: tokens.fontSize.sm,
  },
  resolverChipTextSelected: {
    color: colors.mint,
    fontWeight: '600',
  },
  pendingHeaderWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.amberFill,
  },
  pendingHeaderText: {
    fontSize: tokens.fontSize.lg,
    fontWeight: '600',
    color: colors.amber,
  },
  sectionHeaderWrap: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  memberTextCol: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  memberName: {
    fontSize: tokens.fontSize.base,
    fontWeight: '500',
    color: colors.text,
  },
  memberSubtext: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
  },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexShrink: 0,
  },
});
