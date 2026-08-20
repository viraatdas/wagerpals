// Bottom tab navigator with modern iOS styling
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';

import { colors, font, spacing, tokens } from '../theme';

// Exported so screens can pad their scroll content past the absolutely
// positioned bar instead of each one hardcoding its own copy of these
// numbers (several were already doing exactly that).
export const TAB_BAR_HEIGHT_IOS = 88;
export const TAB_BAR_HEIGHT_ANDROID = 64;

import { MainTabParamList } from '../types/navigation';
import HomeScreen from '../screens/HomeScreen';
import ActivityScreen from '../screens/ActivityScreen';
import ExploreScreen from '../screens/ExploreScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'home';

          if (route.name === 'Home') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Activity') {
            iconName = focused ? 'pulse' : 'pulse-outline';
          } else if (route.name === 'Explore') {
            iconName = focused ? 'compass' : 'compass-outline';
          }

          return <Ionicons name={iconName} size={24} color={color} />;
        },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontFamily: font.sansMedium,
          fontSize: 11,
          marginTop: -2,
        },
        // On iOS the bar is transparent and sits on top of a real blur layer
        // (see `tabBarBackground` below), which is what makes content scroll
        // *under* it the way a native tab bar behaves. The previous
        // `rgba(255,255,255,0.94)` fill was the last hardcoded color in the
        // app and only faked translucency — expo-blur is already a
        // dependency, so this is both token-clean and more native.
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : colors.bg,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
          height: Platform.OS === 'ios' ? TAB_BAR_HEIGHT_IOS : TAB_BAR_HEIGHT_ANDROID,
          paddingTop: spacing.sm,
          paddingBottom: Platform.OS === 'ios' ? 28 : spacing.sm,
          shadowColor: tokens.shadow.elev3.shadowColor,
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.04,
          shadowRadius: 16,
        },
        tabBarBackground:
          Platform.OS === 'ios'
            ? () => <BlurView tint="light" intensity={80} style={StyleSheet.absoluteFill} />
            : undefined,
        tabBarItemStyle: {
          paddingVertical: 4,
        },
        headerShown: false,
      })}
      screenListeners={{
        tabPress: () => {
          Haptics.selectionAsync();
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          // "The Board" — see DESIGN-SPEC.md nav copy (Board / Live /
          // History / Wallet / Friends / Profile, not admin nouns).
          title: 'Live',
        }}
      />
      <Tab.Screen
        name="Activity"
        component={ActivityScreen}
        options={{
          title: 'History',
        }}
      />
      <Tab.Screen 
        name="Explore" 
        component={ExploreScreen}
        options={{ 
          title: 'Explore',
        }}
      />
    </Tab.Navigator>
  );
}
