import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { LogBox, View, ActivityIndicator, StyleSheet } from 'react-native';
import { useFonts } from 'expo-font';
import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import RootNavigator from './src/navigation/RootNavigator';
import notificationService from './src/services/notifications';
import authService from './src/services/auth';
import { colors } from './src/theme';

// Ignore certain warnings
LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
]);

export default function App() {
  // theme.ts's `font` token names (display/mono/monoMedium/sans/sansMedium/
  // sansSemiBold) are exactly these keys — see src/theme.ts's Font section.
  // Plex Mono never renders above weight 500 (see MOBILE-SPEC.md), so only
  // 400/500 are loaded for it.
  const [fontsLoaded] = useFonts({
    ArchivoBlack_400Regular,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
  });

  useEffect(() => {
    // Initialize services
    const initializeApp = async () => {
      try {
        await authService.init();
        await notificationService.init();
      } catch (error) {
        console.error('Failed to initialize app:', error);
      }
    };

    initializeApp();

    return () => {
      notificationService.cleanup();
    };
  }, []);

  // Keep the existing loading behavior (a centered spinner on the app's
  // background) until fonts resolve, instead of rendering with system
  // fallback fonts and then flashing to the real ones.
  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <>
      <RootNavigator />
      <StatusBar style="dark" />
    </>
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
