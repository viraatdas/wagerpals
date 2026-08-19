// Root navigator setup with proper flow
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';

import { RootStackParamList } from '../types/navigation';
import { colors, font } from '../theme';
import authService from '../services/auth';
import apiService from '../services/api';
import { AuthUser } from '../types';

// Screens
import AuthScreen from '../screens/AuthScreen';
import UsernameSetupScreen from '../screens/UsernameSetupScreen';
import MainTabNavigator from './MainTabNavigator';
import GroupDetailScreen from '../screens/GroupDetailScreen';
import EventDetailScreen from '../screens/EventDetailScreen';
import CreateEventScreen from '../screens/CreateEventScreen';
import GroupAdminScreen from '../screens/GroupAdminScreen';
import JoinGroupScreen from '../screens/JoinGroupScreen';
import ProfileScreen from '../screens/ProfileScreen';
import EditUsernameScreen from '../screens/EditUsernameScreen';
import CreateEventFromInviteScreen from '../screens/CreateEventFromInviteScreen';
import WalletScreen from '../screens/WalletScreen';
import NotificationPreferencesScreen from '../screens/NotificationPreferencesScreen';
import notificationService from '../services/notifications';
import ErrorBoundary from '../components/ErrorBoundary';
import { ApiError, toApiError } from '../utils/errors';

const Stack = createNativeStackNavigator<RootStackParamList>();

const prefix = Linking.createURL('/');

export default function RootNavigator() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);

  useEffect(() => {
    // Listen for auth state changes
    const unsubscribe = authService.onAuthStateChanged((newUser) => {
      // Audit finding D10: auth.ts builds its AuthUser as
      // `id: data.user_id || data.id || ''`, so a partially-successful
      // verify-code response can produce a signed-in user whose id is the
      // empty string. Every request then omits the identity and fails in a
      // way that looks like a broken app rather than a broken sign-in.
      // auth.ts is owned by an earlier node, so rather than edit it we
      // refuse to treat an id-less user as signed in — the app falls back
      // to the auth screen, which is recoverable, instead of a logged-in
      // state where nothing works.
      const usable = newUser && newUser.id ? newUser : null;
      if (newUser && !newUser.id) {
        console.error('[nav] auth produced a user with no id; treating as signed out (audit D10)');
      }

      setUser(usable);
      setIsLoading(false);

      // Check if user needs to set up username
      if (usable) {
        checkUserUsername(usable.id);
      } else {
        setNeedsUsername(false);
        // The API layer caches GET responses keyed by URL only — it has no
        // notion of *whose* data it holds. Without this, signing out and
        // signing in as someone else on the same device would render the
        // previous account's groups/activity/balance from cache until each
        // entry's TTL lapsed.
        apiService.clearCache();
      }
    });

    return unsubscribe;
  }, []);

  const checkUserUsername = async (userId: string) => {
    setCheckingUsername(true);
    try {
      await apiService.syncUser();
    } catch (error) {
      // A sync failure should not block the flow — fall through to getUser.
    }
    try {
      const userData = await apiService.getUser(userId);
      // If the user hasn't deliberately picked a username yet, they need to set one
      setNeedsUsername(!userData?.username_selected);
    } catch (error) {
      // Only a definitive "this user has no row yet" answer should push
      // someone into the username picker. The old code treated EVERY failure
      // as "needs a username", so a subway-tunnel network blip would drop an
      // established user into first-run setup and invite them to rename
      // themselves. A transport failure (offline/timeout) or a server error
      // tells us nothing about their username, so we leave the flag alone
      // and let the app render; the next successful sync corrects it.
      const err = error instanceof ApiError ? error : toApiError(error, '/api/users');
      if (err.status === 404) {
        setNeedsUsername(true);
      } else {
        console.warn('[nav] username check inconclusive, not forcing setup:', err.kind, err.status ?? '');
      }
    } finally {
      setCheckingUsername(false);
    }
  };

  // Subscribe to push notifications when a user is available
  useEffect(() => {
    if (user?.id && !needsUsername) {
      // Ensure notifications are initialized and token is subscribed for this user
      notificationService.init(user.id);
    }
  }, [user?.id, needsUsername]);

  // Callback when username is set
  const handleUsernameSet = () => {
    setNeedsUsername(false);
  };

  const linking = {
    prefixes: [prefix, 'wagerpals://', 'https://wagerpals.io', 'https://*.wagerpals.io'],
    config: {
      screens: {
        Main: {
          screens: {
            Home: '',
            Activity: 'activity',
            Explore: 'explore',
          },
        },
        GroupDetail: 'groups/:groupId',
        EventDetail: 'events/:eventId',
        JoinGroup: 'groups/join/:groupId',
        GroupAdmin: 'groups/:groupId/admin',
        CreateEventFromInvite: {
          path: 'invite',
          parse: {
            title: (title: string) => decodeURIComponent(title),
            sideA: (sideA: string) => decodeURIComponent(sideA),
            sideB: (sideB: string) => decodeURIComponent(sideB),
            pick: (pick: string) => decodeURIComponent(pick),
            amount: (amount: string) => decodeURIComponent(amount),
          },
        },
      },
    },
  } as any;

  // Show loading screen
  if (isLoading || checkingUsername) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    // Audit finding D6: a single thrown render error used to unmount the
    // entire tree to a blank white screen in release builds, with no way
    // back. The boundary lives OUTSIDE NavigationContainer so it survives a
    // crash in any screen, and its reset re-runs the auth/username check
    // rather than just re-rendering the same broken subtree.
    <ErrorBoundary onReset={() => { if (user) checkUserUsername(user.id); }}>
      <NavigationContainer linking={linking}>
        <Stack.Navigator
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: colors.bg },
          // Header titles are Jakarta semibold — Archivo Black is reserved
          // for screens that render their own big title (DESIGN-SPEC.md).
          headerTitleStyle: { color: colors.text, fontFamily: font.sansSemiBold },
          contentStyle: { backgroundColor: colors.bg2 },
          animation: 'slide_from_right',
        }}
      >
        {!user ? (
          <Stack.Screen name="Auth" component={AuthScreen} />
        ) : needsUsername ? (
          <Stack.Screen name="UsernameSetup">
            {(props) => <UsernameSetupScreen {...props} onUsernameSet={handleUsernameSet} />}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabNavigator} />
            <Stack.Screen 
              name="GroupDetail" 
              component={GroupDetailScreen}
              options={{ 
                headerShown: true, 
                title: 'Group',
                headerTintColor: colors.brand,
                headerBackTitle: 'Back',
              }}
            />
            <Stack.Screen 
              name="EventDetail" 
              component={EventDetailScreen}
              options={{ 
                headerShown: true, 
                title: 'Event',
                headerTintColor: colors.brand,
                headerBackTitle: 'Back',
              }}
            />
            <Stack.Screen 
              name="CreateEvent" 
              component={CreateEventScreen}
              options={{ 
                headerShown: true, 
                title: 'Create Event', 
                presentation: 'modal',
                headerTintColor: colors.brand,
              }}
            />
            <Stack.Screen 
              name="GroupAdmin" 
              component={GroupAdminScreen}
              options={{ 
                headerShown: true, 
                title: 'Manage Group',
                headerTintColor: colors.brand,
                headerBackTitle: 'Back',
              }}
            />
            <Stack.Screen 
              name="JoinGroup" 
              component={JoinGroupScreen}
              options={{ 
                headerShown: true, 
                title: 'Join Group',
                headerTintColor: colors.brand,
                headerBackTitle: 'Back',
              }}
            />
            <Stack.Screen 
              name="Profile" 
              component={ProfileScreen}
              options={{ 
                headerShown: true, 
                title: 'Profile',
                headerTintColor: colors.brand,
                headerBackTitle: 'Back',
              }}
            />
            <Stack.Screen
              name="EditUsername"
              component={EditUsernameScreen}
              options={{
                headerShown: true,
                title: 'Edit Username',
                presentation: 'modal',
                headerTintColor: colors.brand,
              }}
            />
            <Stack.Screen
              name="CreateEventFromInvite"
              component={CreateEventFromInviteScreen}
              options={{
                headerShown: true,
                title: 'Wager Invite',
                presentation: 'modal',
                headerTintColor: colors.brand,
              }}
            />
            <Stack.Screen
              name="Wallet"
              component={WalletScreen}
              options={{
                headerShown: true,
                title: 'Wallet',
                headerTintColor: colors.brand,
                headerBackTitle: 'Back',
              }}
            />
            <Stack.Screen
              name="NotificationPreferences"
              component={NotificationPreferencesScreen}
              options={{
                headerShown: true,
                title: 'Notifications',
                headerTintColor: colors.brand,
                headerBackTitle: 'Back',
              }}
            />
          </>
        )}
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
});
