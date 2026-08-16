// Group Detail Screen - Shows group info, events, and members
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Share,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { Event, GroupMember, Wallet } from '../types';
import { formatDate, formatCurrency } from '../utils/helpers';
import { colors, gradients, radius, glow } from '../theme';

export default function GroupDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { user } = useAuth();
  const { groupId } = route.params as { groupId: string };

  const [group, setGroup] = useState<any>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userStatus, setUserStatus] = useState<'active' | 'pending'>('active');

  useFocusEffect(
    useCallback(() => {
      loadGroupData();
    }, [groupId, user])
  );

  const loadGroupData = async () => {
    if (!user) return;

    try {
      const [groupData, eventsData] = await Promise.all([
        apiService.getGroup(groupId),
        apiService.getEvents(groupId),
      ]);
      setGroup(groupData);
      setEvents(eventsData);

      // Check user's role and status
      const userMember = groupData.members?.find((m: GroupMember) => m.user_id === user.id);
      setIsAdmin(userMember?.role === 'admin');
      setUserStatus(userMember?.status || 'pending');

      // Fetch members
      const membersData = groupData.members || await apiService.getGroupMembers(groupId);
      setMembers(membersData);

      if (!groupData.is_public) {
        apiService.getWallet(user.id)
          .then((data) => setWallet(data.wallet))
          .catch((error) => console.error('Failed to load wallet:', error));
      }
    } catch (error) {
      console.error('Failed to load group data:', error);
      Alert.alert('Error', 'Failed to load group data');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleDeposit = () => {
    Linking.openURL('https://wagerpals.io/profile?wallet=deposit');
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadGroupData();
  };

  const handleShareInvite = async () => {
    try {
      const message = `Join my betting group "${group.name}" on WagerPals!\n\nUse code: ${groupId}\n\nOr click: wagerpals://groups/join/${groupId}`;
      
      await Share.share({
        message,
        title: `Join ${group.name} on WagerPals`,
      });
    } catch (error) {
      console.error('Failed to share:', error);
    }
  };

  const categorizeEvents = () => {
    const now = Date.now();
    const active = events.filter((e) => e.status === 'active' && e.end_time > now);
    const ended = events.filter((e) => e.status === 'resolved' || (e.status === 'active' && e.end_time <= now));
    return { active, ended };
  };

  const renderEventCard = (event: Event) => {
    const isActive = event.status === 'active' && event.end_time > Date.now();
    const isResolved = event.status === 'resolved';

    return (
      <TouchableOpacity
        key={event.id}
        style={styles.eventCard}
        onPress={() => navigation.navigate('EventDetail' as never, { eventId: event.id } as never)}
      >
        <View style={styles.eventHeader}>
          <Text style={styles.eventTitle} numberOfLines={1}>
            {event.title}
          </Text>
          <View style={[styles.statusBadge, isActive ? styles.activeBadge : styles.endedBadge]}>
            <Text style={styles.statusText}>{isActive ? 'Active' : isResolved ? 'Resolved' : 'Ended'}</Text>
          </View>
        </View>

        <View style={styles.sidesRow}>
          <View style={styles.sideBox}>
            <Text style={styles.sideText} numberOfLines={1}>{event.side_a}</Text>
          </View>
          <Text style={styles.vsText}>vs</Text>
          <View style={styles.sideBox}>
            <Text style={styles.sideText} numberOfLines={1}>{event.side_b}</Text>
          </View>
        </View>

        {isActive ? (
          <Text style={styles.eventTime}>Ends {formatDate(event.end_time)}</Text>
        ) : isResolved && event.resolution ? (
          <Text style={styles.winnerText}>Winner: {event.resolution.winning_side}</Text>
        ) : (
          <Text style={styles.eventTime}>Betting closed</Text>
        )}
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.brand2} />
      </View>
    );
  }

  // Show pending approval message
  if (userStatus === 'pending') {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.pendingContainer}>
          <Ionicons name="hourglass-outline" size={64} color={colors.amber} />
          <Text style={styles.pendingTitle}>Pending Approval</Text>
          <Text style={styles.pendingText}>
            Your request to join "{group?.name}" is waiting for admin approval.
          </Text>
          <Text style={styles.pendingSubtext}>
            You'll receive a notification when you're approved.
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const { active, ended } = categorizeEvents();

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.brand2} />}
      >
        {/* Group Header */}
        <View style={styles.header}>
          <Text style={styles.groupName}>{group?.name}</Text>
          <View style={styles.groupInfo}>
            <Text style={styles.groupCode}>Code: {groupId}</Text>
            <Text style={styles.dot}>•</Text>
            <Text style={styles.memberCount}>{members.length} members</Text>
          </View>
        </View>

        {!group?.is_public && (
          <View style={styles.walletCard}>
            <View style={styles.walletHeader}>
              <View>
                <Text style={styles.walletLabel}>Paid group wallet</Text>
                <Text style={styles.walletBalance}>{formatCurrency(wallet?.balance || 0)}</Text>
              </View>
              <TouchableOpacity style={styles.depositButtonWrap} onPress={handleDeposit} activeOpacity={0.85}>
                <LinearGradient
                  colors={gradients.brand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.depositButton}
                >
                  <Ionicons name="card-outline" size={18} color={colors.white} />
                  <Text style={styles.depositButtonText}>Deposit</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
            <Text style={styles.resolverText}>
              Resolver: @{group.resolver?.username || 'Not set'}
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionButton} onPress={handleShareInvite}>
            <Ionicons name="share-outline" size={20} color={colors.brand2} />
            <Text style={styles.actionButtonText}>Invite</Text>
          </TouchableOpacity>

          {isAdmin && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => navigation.navigate('GroupAdmin' as never, { groupId } as never)}
            >
              <Ionicons name="settings-outline" size={20} color={colors.brand2} />
              <Text style={styles.actionButtonText}>Manage</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('CreateEvent' as never, { groupId } as never)}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.brand2} />
            <Text style={styles.actionButtonText}>New Event</Text>
          </TouchableOpacity>
        </View>

        {/* Active Events */}
        {active.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active Events</Text>
            {active.map(renderEventCard)}
          </View>
        )}

        {/* Ended Events */}
        {ended.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ended Events</Text>
            {ended.slice(0, 5).map(renderEventCard)}
          </View>
        )}

        {events.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No events yet</Text>
            <Text style={styles.emptyStateSubtext}>
              Create your first event to get started!
            </Text>
          </View>
        )}

        {/* Members Preview */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Members ({members.length})</Text>
          {members.filter(m => m.status === 'active').slice(0, 5).map((member) => (
            <View key={member.user_id} style={styles.memberItem}>
              <Text style={styles.memberName}>{member.username}</Text>
              {member.role === 'admin' && (
                <View style={styles.adminBadge}>
                  <Text style={styles.adminBadgeText}>Admin</Text>
                </View>
              )}
            </View>
          ))}
          {members.filter(m => m.status === 'active').length > 5 && (
            <Text style={styles.moreText}>
              +{members.filter(m => m.status === 'active').length - 5} more
            </Text>
          )}
        </View>
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
  pendingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  pendingTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  pendingText: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 8,
  },
  pendingSubtext: {
    fontSize: 14,
    color: colors.textFaint,
    textAlign: 'center',
    marginBottom: 24,
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
  },
  backButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  groupName: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  groupInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupCode: {
    fontSize: 14,
    color: colors.textMuted,
  },
  dot: {
    marginHorizontal: 8,
    color: colors.textMuted,
  },
  memberCount: {
    fontSize: 14,
    color: colors.textMuted,
  },
  actionsRow: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  walletCard: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    backgroundColor: colors.surfaceGlass,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  walletHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  walletLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 4,
  },
  walletBalance: {
    fontSize: 24,
    color: colors.mint,
    fontWeight: '700',
  },
  depositButtonWrap: {
    borderRadius: radius.pill,
    ...glow(colors.brand2),
  },
  depositButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  depositButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  resolverText: {
    marginTop: 10,
    color: colors.textMuted,
    fontSize: 13,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    gap: 6,
  },
  actionButtonText: {
    color: colors.brand2,
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  eventCard: {
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  eventTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '500',
    color: colors.text,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  activeBadge: {
    backgroundColor: colors.mintFill,
  },
  endedBadge: {
    backgroundColor: colors.surfaceGlassStrong,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.text,
  },
  sidesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sideBox: {
    flex: 1,
    padding: 12,
    backgroundColor: colors.surfaceGlassStrong,
    borderRadius: radius.md,
  },
  sideText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    textAlign: 'center',
  },
  vsText: {
    marginHorizontal: 8,
    fontSize: 12,
    color: colors.textFaint,
  },
  eventTime: {
    fontSize: 12,
    color: colors.textMuted,
  },
  winnerText: {
    fontSize: 14,
    color: colors.mint,
    fontWeight: '500',
  },
  emptyState: {
    padding: 48,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 20,
    color: colors.textMuted,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 16,
    color: colors.textFaint,
    textAlign: 'center',
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  memberName: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  adminBadge: {
    backgroundColor: colors.brandFill,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  adminBadgeText: {
    fontSize: 12,
    color: colors.brand2,
  },
  moreText: {
    marginTop: 8,
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
});
