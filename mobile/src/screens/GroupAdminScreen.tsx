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
import { handle } from '../utils/format';
import { colors, font, radius, spacing, tokens } from '../theme';
import { Avatar, Button, Card, EmptyState, ErrorState, Pill, SectionHeader, Skeleton, SkeletonList, Toggle } from '../components';
import TextInputModal from '../components/TextInputModal';

type GroupData = Group & { members?: GroupMember[]; pending_requests?: GroupMember[] };
// Flat-groups model: there's exactly one admin per group (the creator), so
// promote/demote no longer exist. approve/decline survive only to let a
// creator clear out any legacy 'pending' rows written before joins-by-code
// became instantly active — new joins never produce one.
type MemberAction = 'approve' | 'decline' | 'remove';
type SectionKey = 'pending' | 'members';

// Per-action success copy — each names the actual member and the actual
// outcome instead of a generic "Action completed."
const ACTION_CONFIRMATION: Record<MemberAction, (username: string) => string> = {
  approve: (u) => `${handle(u)} is in.`,
  decline: (u) => `Declined ${handle(u)}'s request.`,
  remove: (u) => `Removed ${handle(u)} from the group.`,
};
const CONFIRMATION_VISIBLE_MS = 2200;

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
    message: (u) => `Approve ${handle(u)}'s request to join?`,
    confirmLabel: 'Approve',
    destructive: false,
    failTitle: "Couldn't approve request",
  },
  decline: {
    title: 'Decline request',
    message: (u) => `Decline ${handle(u)}'s request to join? They can request to join again later.`,
    confirmLabel: 'Decline',
    destructive: true,
    failTitle: "Couldn't decline request",
  },
  remove: {
    title: 'Remove member',
    message: (u) => `Remove ${handle(u)} from the group? They'd need a fresh invite to come back.`,
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
  const [isTogglingCash, setIsTogglingCash] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const statusTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatus = useCallback((message: string) => {
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    setStatusMessage(message);
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(null), CONFIRMATION_VISIBLE_MS);
  }, []);

  React.useEffect(() => () => {
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
  }, []);

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

  // Flat-groups model: there's one admin per group — the creator. This
  // screen is their "Manage" screen; nobody else can promote/demote or
  // reach it at all (see the not-creator branch below).
  const viewerIsCreator = !!user && !!group && user.id === group.created_by;

  const sections = useMemo<MemberSection[]>(() => {
    // 'pending' rows are legacy — new joins-by-code are instantly active —
    // but a creator can still clear out any that were written before this
    // change, so the section stays if any survive.
    const pending = members.filter((m) => m.status === 'pending');
    const active = members.filter((m) => m.status === 'active');

    const result: MemberSection[] = [];
    if (pending.length > 0) {
      result.push({ key: 'pending', title: `Pending Requests (${pending.length})`, data: pending });
    }
    result.push({ key: 'members', title: `Members (${active.length})`, data: active });
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
        showStatus(ACTION_CONFIRMATION[action](username));
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
    [groupId, members, rowBusy, user, showStatus]
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

  const runCashToggle = useCallback(
    async (nextCashEnabled: boolean) => {
      if (!group || isTogglingCash) return;
      warning();
      setIsTogglingCash(true);
      try {
        const updated = await apiService.updateGroupSettings({ id: groupId, cash_enabled: nextCashEnabled });
        setGroup((prev) => (prev ? { ...prev, ...updated } : (updated as GroupData)));
        success();
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups');
        hapticError();
        Alert.alert("Couldn't update group", apiErr.userMessage);
      } finally {
        setIsTogglingCash(false);
      }
    },
    [group, groupId, isTogglingCash]
  );

  const handleCashToggle = useCallback(
    (nextCashEnabled: boolean) => {
      if (!group) return;
      if (!nextCashEnabled) {
        // Turning cash off is non-destructive to existing money — it only
        // stops NEW cash events from being created — so it needs no confirm.
        void runCashToggle(false);
        return;
      }
      Alert.alert(
        'Turn on cash wagers?',
        'Members will be able to stake real money from their wallets on new events in this group.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Turn on', onPress: () => void runCashToggle(true) },
        ]
      );
    },
    [group, runCashToggle]
  );

  const runRenameGroup = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || isRenaming) return;
      setIsRenaming(true);
      try {
        const updated = await apiService.updateGroupSettings({ id: groupId, name: trimmed });
        setGroup((prev) => (prev ? { ...prev, ...updated } : (updated as GroupData)));
        success();
        setShowRenameModal(false);
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups');
        hapticError();
        Alert.alert("Couldn't rename group", apiErr.userMessage);
      } finally {
        setIsRenaming(false);
      }
    },
    [groupId, isRenaming]
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

  // ---- Loaded, but the signed-in user isn't the creator: nothing to manage here ----
  // Flat-groups model: only the creator manages a group — no admin roster.
  if (group && !viewerIsCreator) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <SectionList
          sections={[]}
          renderItem={() => null}
          keyExtractor={() => 'noop'}
          ListEmptyComponent={
            <ErrorState
              title="Creator only"
              message="Only the person who created this group can manage it."
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

  const isCreator = viewerIsCreator;

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
            {statusMessage ? (
              <View style={styles.statusBanner}>
                <Ionicons name="checkmark-circle" size={16} color={tokens.color.win} />
                <Text style={styles.statusBannerText} numberOfLines={2}>
                  {statusMessage}
                </Text>
              </View>
            ) : null}

            {error && group ? (
              <ErrorState compact title="Couldn't refresh" message={error.userMessage} onRetry={handleRefresh} style={styles.inlineError} />
            ) : null}

            <View style={styles.section}>
              <SectionHeader title="Group Settings" />
              <Card>
                <Pressable
                  style={styles.renameRow}
                  onPress={() => setShowRenameModal(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Rename group"
                >
                  <View style={styles.renameTextCol}>
                    <Text style={styles.renameLabel}>Name</Text>
                    <Text style={styles.renameValue} numberOfLines={1} ellipsizeMode="tail">
                      {group?.name}
                    </Text>
                  </View>
                  <Ionicons name="create-outline" size={18} color={colors.textMuted} />
                </Pressable>

                <View style={styles.settingsDivider} />

                <Toggle
                  label="Cash wagers"
                  description={
                    group?.cash_enabled
                      ? 'Members can stake real money from their wallets.'
                      : 'Bets stake W: WagerPals’ play currency.'
                  }
                  value={!!group?.cash_enabled}
                  onValueChange={handleCashToggle}
                  disabled={isTogglingCash}
                />
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
                    {handle(username)}
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

          // Flat-groups model: one section for every active member. The
          // creator is labeled, not "Admin" — there's no promote/demote,
          // and the creator can't remove themselves (deleting the group is
          // the only way to end it).
          const isRowCreator = item.user_id === group?.created_by;
          return (
            <View style={styles.memberRow}>
              <Avatar username={item.username} size="md" />
              <View style={styles.memberTextCol}>
                <Text style={styles.memberName} numberOfLines={1} ellipsizeMode="tail">
                  {handle(username)}
                </Text>
                <Pill label={isRowCreator ? 'Creator' : 'Member'} tone={isRowCreator ? 'brand' : 'neutral'} size="sm" />
              </View>
              {!isRowCreator && !isSelf && (
                <View style={styles.rowActions}>
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
              )}
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

      <TextInputModal
        visible={showRenameModal}
        title="Rename group"
        placeholder="Group name"
        defaultValue={group?.name}
        onSubmit={runRenameGroup}
        onCancel={() => setShowRenameModal(false)}
        submitText="Save"
        loading={isRenaming}
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
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: tokens.color.yesFill,
    borderRadius: radius.lg,
  },
  statusBannerText: {
    flex: 1,
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.win,
  },
  section: {
    padding: spacing.lg,
  },
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    gap: spacing.md,
  },
  renameTextCol: {
    flex: 1,
    minWidth: 0,
  },
  renameLabel: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
    marginBottom: 2,
  },
  renameValue: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.base,
    color: colors.text,
  },
  settingsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
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
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.lg,
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
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.base,
    color: colors.text,
  },
  memberSubtext: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
  },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexShrink: 0,
  },
});
