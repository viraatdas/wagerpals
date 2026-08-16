// Profile screen - Modern iOS design
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  StatusBar,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { User } from '../types';
import { formatCurrency } from '../utils/helpers';
import notificationService from '../services/notifications';
import { colors, gradients, radius, glow } from '../theme';
import { LinearGradient } from 'expo-linear-gradient';

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { user: authUser, signOut } = useAuth();
  const [userData, setUserData] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadUserData();
  }, [authUser]);

  const loadUserData = async () => {
    if (!authUser) return;

    try {
      const data = await apiService.getUser(authUser.id);
      setUserData(data);
    } catch (error) {
      console.error('Failed to load user data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
          },
        },
      ]
    );
  };

  const handleTestNotification = async () => {
    if (!authUser?.id) return;
    try {
      await notificationService.init(authUser.id);
      await apiService.sendPushToUser({
        userId: authUser.id,
        title: 'Test Notification 🎉',
        body: 'Push notifications are working!',
      });
      Alert.alert('Success', 'Test notification sent!');
    } catch (e) {
      console.error('Test push failed', e);
      Alert.alert('Error', 'Failed to send test notification. Make sure you\'re on a physical device.');
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.brand2} />
      </View>
    );
  }

  const netTotal = userData?.net_total || 0;
  const isPositive = netTotal >= 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <LinearGradient
            colors={gradients.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarContainer}
          >
            <Text style={styles.avatarText}>
              {userData?.username?.charAt(0).toUpperCase() || '?'}
            </Text>
          </LinearGradient>
          <Text style={styles.username}>@{userData?.username}</Text>
          <Text style={styles.email}>{authUser?.email}</Text>
        </View>

        {/* Stats Cards */}
        <View style={styles.statsContainer}>
          <View style={[styles.statCard, styles.mainStatCard]}>
            <Text style={styles.mainStatLabel}>Net Total</Text>
            <Text style={[styles.mainStatValue, isPositive ? styles.positive : styles.negative]}>
              {isPositive ? '+' : ''}{formatCurrency(netTotal)}
            </Text>
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{formatCurrency(userData?.total_bet || 0)}</Text>
              <Text style={styles.statLabel}>Total Bet</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{userData?.streak || 0}</Text>
              <Text style={styles.statLabel}>Win Streak</Text>
            </View>
          </View>
        </View>

        {/* Menu Section */}
        <View style={styles.menuSection}>
          <Text style={styles.sectionTitle}>Settings</Text>
          
          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('EditUsername' as never)}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIconContainer, { backgroundColor: colors.cyanFill }]}>
                <Ionicons name="create-outline" size={20} color={colors.cyan} />
              </View>
              <Text style={styles.menuText}>Edit Username</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleTestNotification}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIconContainer, { backgroundColor: colors.amberFill }]}>
                <Ionicons name="notifications-outline" size={20} color={colors.amber} />
              </View>
              <Text style={styles.menuText}>Test Notifications</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleSignOut}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIconContainer, { backgroundColor: colors.roseFill }]}>
                <Ionicons name="log-out-outline" size={20} color={colors.rose} />
              </View>
              <Text style={[styles.menuText, styles.signOutText]}>Sign Out</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>
        </View>

        {/* App Version */}
        <Text style={styles.versionText}>WagerPals v1.0.1</Text>
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
  profileHeader: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 24,
  },
  avatarContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    ...glow(colors.brand2, 0.5),
  },
  avatarText: {
    fontSize: 36,
    fontWeight: '600',
    color: '#fff',
  },
  username: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: colors.textMuted,
  },
  statsContainer: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    alignItems: 'center',
  },
  mainStatCard: {
    marginBottom: 12,
    paddingVertical: 20,
  },
  mainStatLabel: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 4,
  },
  mainStatValue: {
    fontSize: 32,
    fontWeight: '700',
  },
  positive: {
    color: colors.mint,
  },
  negative: {
    color: colors.rose,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  menuSection: {
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  menuCard: {
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    marginBottom: 12,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    fontWeight: '500',
  },
  signOutText: {
    color: colors.rose,
  },
  menuDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 66,
  },
  versionText: {
    fontSize: 12,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 32,
  },
});
