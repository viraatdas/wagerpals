// Root navigator setup with proper flow
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';

import { RootStackParamList } from '../types/navigation';
import { colors } from '../theme';
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
import notificationService from '../services/notifications';

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
      setUser(newUser);
      setIsLoading(false);
      
      // Check if user needs to set up username
      if (newUser) {
        checkUserUsername(newUser.id);
      } else {
        setNeedsUsername(false);
      }
    });

    return unsubscribe;
  }, []);

  const checkUserUsername = async (userId: string) => {
    setCheckingUsername(true);
    try {
      const userData = await apiService.getUser(userId);
      // If user has no username or it's empty, they need to set one
      setNeedsUsername(!userData?.username);
    } catch (error) {
      // If user doesn't exist in our DB yet, they need to set up username
      setNeedsUsername(true);
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
    <NavigationContainer linking={linking}>
      <Stack.Navigator 
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: colors.bg },
          headerTitleStyle: { color: colors.text },
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
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
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
