// Group Admin Screen - Manage members
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { GroupMember } from '../types';
import { colors, gradients, radius, glow } from '../theme';

export default function GroupAdminScreen() {
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { groupId } = route.params as { groupId: string };

  const [group, setGroup] = useState<any>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadMembers();
  }, [groupId]);

  const loadMembers = async () => {
    try {
      const [groupData, data] = await Promise.all([
        apiService.getGroup(groupId),
        apiService.getGroupMembers(groupId),
      ]);
      setGroup(groupData);
      setMembers(data);
    } catch (error) {
      console.error('Failed to load members:', error);
      Alert.alert('Error', 'Failed to load members');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleResolverChange = async (member: GroupMember) => {
    Alert.alert(
      'Set Resolver',
      `Make ${member.username} the resolver for paid events?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set Resolver',
          onPress: async () => {
            try {
              await apiService.updateGroupSettings({ id: groupId, resolver_user_id: member.user_id });
              Alert.alert('Updated', `${member.username} is now the resolver.`);
              loadMembers();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to set resolver');
            }
          },
        },
      ]
    );
  };

  const handlePaidToggle = async () => {
    try {
      await apiService.updateGroupSettings({ id: groupId, is_public: !group?.is_public });
      loadMembers();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update group');
    }
  };

  const handleDeleteGroup = async () => {
    Alert.alert(
      'Delete Group',
      `Delete ${group?.name || 'this group'} and all of its events?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiService.deleteGroup(groupId);
              navigation.navigate('Home' as never);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete group');
            }
          },
        },
      ]
    );
  };

  const handleAction = async (
    action: 'approve' | 'decline' | 'promote' | 'demote' | 'remove',
    targetUserId: string,
    username: string
  ) => {
    if (!user) return;

    const actionMessages = {
      approve: `Approve ${username}?`,
      decline: `Decline ${username}'s request?`,
      promote: `Promote ${username} to admin?`,
      demote: `Demote ${username} to member?`,
      remove: `Remove ${username} from group?`,
    };

    Alert.alert(
      'Confirm Action',
      actionMessages[action],
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              await apiService.manageGroupMember(action, groupId, user.id, targetUserId);
              Alert.alert('Success', `Action completed successfully`);
              loadMembers();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to perform action');
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.brand2} />
      </View>
    );
  }

  const pendingMembers = members.filter((m) => m.status === 'pending');
  const activeMembers = members.filter((m) => m.status === 'active');
  const admins = activeMembers.filter((m) => m.role === 'admin');
  const regularMembers = activeMembers.filter((m) => m.role === 'member');

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => { setIsRefreshing(true); loadMembers(); }} tintColor={colors.brand2} />}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Paid Group Settings</Text>
          <View style={styles.settingsCard}>
            <Text style={styles.settingsText}>
              Status: {group?.is_public ? 'Free points' : 'Paid wallet betting'}
            </Text>
            <TouchableOpacity style={styles.fullButtonWrap} onPress={handlePaidToggle} activeOpacity={0.85}>
              <LinearGradient
                colors={gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.fullButton}
              >
                <Text style={styles.fullButtonText}>
                  {group?.is_public ? 'Enable Paid Betting' : 'Use Free Points'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            {!group?.is_public && (
              <>
                <Text style={styles.settingsText}>
                  Resolver: @{group?.resolver?.username || 'Not set'}
                </Text>
                <View style={styles.resolverList}>
                  {activeMembers.map((member) => (
                    <TouchableOpacity
                      key={member.user_id}
                      style={[
                        styles.resolverChip,
                        group?.resolver?.user_id === member.user_id && styles.resolverChipSelected,
                      ]}
                      onPress={() => handleResolverChange(member)}
                    >
                      <Text
                        style={[
                          styles.resolverChipText,
                          group?.resolver?.user_id === member.user_id && styles.resolverChipTextSelected,
                        ]}
                      >
                        @{member.username}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </View>
        </View>

        {/* Pending Requests */}
        {pendingMembers.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending Requests ({pendingMembers.length})</Text>
            {pendingMembers.map((member) => (
              <View key={member.user_id} style={styles.memberCard}>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{member.username}</Text>
                  <Text style={styles.memberStatus}>Waiting for approval</Text>
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.approveBtn]}
                    onPress={() => handleAction('approve', member.user_id, member.username || '')}
                  >
                    <Ionicons name="checkmark" size={20} color={colors.mint} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.declineBtn]}
                    onPress={() => handleAction('decline', member.user_id, member.username || '')}
                  >
                    <Ionicons name="close" size={20} color={colors.rose} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Admins */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Admins ({admins.length})</Text>
          {admins.map((member) => (
            <View key={member.user_id} style={styles.memberCard}>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{member.username}</Text>
                <View style={styles.adminBadge}>
                  <Text style={styles.adminBadgeText}>Admin</Text>
                </View>
              </View>
              {member.user_id !== user?.id && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.secondaryBtn]}
                  onPress={() => handleAction('demote', member.user_id, member.username || '')}
                >
                  <Text style={[styles.btnText, styles.btnTextSecondary]}>Demote</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>

        {/* Members */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Members ({regularMembers.length})</Text>
          {regularMembers.map((member) => (
            <View key={member.user_id} style={styles.memberCard}>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{member.username}</Text>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.promoteBtnWrap}
                  onPress={() => handleAction('promote', member.user_id, member.username || '')}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={gradients.brand}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.actionBtn}
                  >
                    <Text style={styles.btnText}>Promote</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.removeBtn]}
                  onPress={() => handleAction('remove', member.user_id, member.username || '')}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.rose} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        {user?.id === group?.created_by && (
          <View style={styles.section}>
            <TouchableOpacity style={styles.deleteGroupButton} onPress={handleDeleteGroup}>
              <Ionicons name="trash-outline" size={18} color={colors.rose} />
              <Text style={styles.deleteGroupButtonText}>Delete Group</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  settingsCard: {
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    gap: 12,
  },
  settingsText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  fullButtonWrap: {
    borderRadius: radius.pill,
    ...glow(colors.brand2),
  },
  fullButton: {
    paddingVertical: 11,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  fullButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  resolverList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  resolverChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surfaceGlass,
  },
  resolverChipSelected: {
    backgroundColor: colors.mintFill,
    borderColor: colors.mint,
  },
  resolverChipText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  resolverChipTextSelected: {
    color: colors.mint,
    fontWeight: '600',
  },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: 8,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 4,
  },
  memberStatus: {
    fontSize: 14,
    color: colors.textMuted,
  },
  adminBadge: {
    backgroundColor: colors.brandFill,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  adminBadgeText: {
    fontSize: 12,
    color: colors.brand2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    padding: 8,
    borderRadius: radius.pill,
    minWidth: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveBtn: {
    backgroundColor: colors.mintFill,
    borderWidth: 1,
    borderColor: colors.mint,
  },
  declineBtn: {
    backgroundColor: colors.roseFill,
    borderWidth: 1,
    borderColor: colors.rose,
  },
  secondaryBtn: {
    backgroundColor: colors.surfaceGlassStrong,
    borderWidth: 1,
    borderColor: colors.border,
  },
  promoteBtnWrap: {
    borderRadius: radius.pill,
    ...glow(colors.brand2),
  },
  removeBtn: {
    backgroundColor: colors.roseFill,
    borderWidth: 1,
    borderColor: colors.rose,
  },
  deleteGroupButton: {
    backgroundColor: colors.roseFill,
    borderWidth: 1,
    borderColor: colors.rose,
    borderRadius: radius.lg,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  deleteGroupButtonText: {
    color: colors.rose,
    fontWeight: '600',
  },
  btnText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  btnTextSecondary: {
    color: colors.text,
  },
});
