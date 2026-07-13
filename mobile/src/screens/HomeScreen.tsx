// Home screen - Shows user's groups with modern iOS design
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { Group } from '../types';
import TextInputModal from '../components/TextInputModal';
import { tapLight, tapMedium, success, error as hapticError } from '../utils/haptics';
import { colors, gradients, radius, glow } from '../theme';
import { LinearGradient } from 'expo-linear-gradient';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadGroups();
    }, [user])
  );

  const loadGroups = async () => {
    if (!user) return;

    try {
      const data = await apiService.getGroups(user.id);
      setGroups(data);
    } catch (error) {
      console.error('Failed to load groups:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadGroups();
  };

  const handleCreateGroup = async (groupName: string) => {
    if (!user) return;

    setShowCreateModal(false);
    try {
      const newGroup = await apiService.createGroup(groupName, user.id);
      success();
      navigation.navigate('GroupDetail' as never, { groupId: newGroup.id } as never);
    } catch (err: any) {
      hapticError();
      Alert.alert('Error', err.message || 'Failed to create group');
    }
  };

  const handleJoinGroup = async (groupCode: string) => {
    if (!user) return;

    setShowJoinModal(false);
    try {
      await apiService.joinGroup(groupCode.toUpperCase(), user.id);
      success();
      Alert.alert('Success', 'Join request submitted! Waiting for admin approval.');
      loadGroups();
    } catch (err: any) {
      hapticError();
      Alert.alert('Error', err.message || 'Failed to join group');
    }
  };

  const renderGroupItem = ({ item }: { item: Group }) => (
    <TouchableOpacity
      style={styles.groupCard}
      onPress={() => { tapLight(); navigation.navigate('GroupDetail' as never, { groupId: item.id } as never); }}
      activeOpacity={0.7}
    >
      <View style={styles.groupCardInner}>
        <View style={styles.groupIconContainer}>
          <Ionicons name="people" size={24} color={colors.brand2} />
        </View>
        <View style={styles.groupInfo}>
          <View style={styles.groupHeader}>
            <Text style={styles.groupName} numberOfLines={1}>{item.name}</Text>
            {item.is_admin && (
              <View style={styles.adminBadge}>
                <Text style={styles.adminBadgeText}>Admin</Text>
              </View>
            )}
          </View>
          <View style={styles.groupMeta}>
            <Text style={styles.groupCode}>{item.id}</Text>
            <Text style={styles.groupDot}>•</Text>
            <Text style={styles.memberCount}>{item.member_count} members</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
      </View>
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.brand2} />
        <Text style={styles.loadingText}>Loading groups...</Text>
      </View>
    );
  }

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
          onPress={() => { tapLight(); navigation.navigate('Profile' as never); }}
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
        
        {groups.length > 0 ? (
          <FlatList
            data={groups}
            renderItem={renderGroupItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.groupsList}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={colors.brand2}
              />
            }
          />
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconContainer}>
              <Ionicons name="people-outline" size={48} color={colors.textFaint} />
            </View>
            <Text style={styles.emptyStateText}>No groups yet</Text>
            <Text style={styles.emptyStateSubtext}>
              Create a group or join one with a code to get started
            </Text>
          </View>
        )}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textMuted,
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
  },
  actionCardAlt: {
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
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
  groupCard: {
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    marginBottom: 12,
  },
  groupCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  groupIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.brandFill,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  groupInfo: {
    flex: 1,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  adminBadge: {
    backgroundColor: colors.brandFill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginLeft: 8,
  },
  adminBadgeText: {
    fontSize: 11,
    color: colors.brand2,
    fontWeight: '600',
  },
  groupMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupCode: {
    fontSize: 13,
    color: colors.textFaint,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  groupDot: {
    fontSize: 13,
    color: colors.textFaint,
    marginHorizontal: 6,
  },
  memberCount: {
    fontSize: 13,
    color: colors.textFaint,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyStateText: {
    fontSize: 18,
    color: colors.text,
    fontWeight: '500',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: colors.textFaint,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 40,
  },
});
