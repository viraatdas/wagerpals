// ErrorBoundary — catches render-time exceptions anywhere below it in the
// tree so one bad screen can't white-screen the whole app in release builds
// (audit finding D6). Class component because React has no hook equivalent
// of componentDidCatch/getDerivedStateFromError yet.
import React, { Component, ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, spacing, tokens, glass } from '../theme';
import { tapMedium } from '../utils/haptics';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Called after the user taps "Try again" and local error state is cleared —
   * use this to reset any external state (e.g. refetch) that caused the crash. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Always log — this is the only signal we get in a release build since
    // there's no crash reporter wired up yet.
    console.error('ErrorBoundary caught an error:', error, info.componentStack);
  }

  handleReset = () => {
    tapMedium();
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.iconChip}>
            <Ionicons name="warning-outline" size={32} color={colors.rose} />
          </View>
          <Text style={styles.title}>Something went wrong</Text>
          {__DEV__ ? (
            <View style={styles.devBlock}>
              <Text style={styles.devText}>{this.state.error?.message ?? 'Unknown error'}</Text>
            </View>
          ) : (
            <Text style={styles.message}>
              We hit a snag loading this screen. Try again. If it keeps happening, restart the app.
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={this.handleReset}
            hitSlop={8}
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  iconChip: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.roseFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.lg,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  message: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: tokens.lineHeight.base,
    marginBottom: spacing.xl,
    maxWidth: 320,
  },
  devBlock: {
    ...glass.card,
    padding: spacing.md,
    marginBottom: spacing.xl,
    maxWidth: 340,
  },
  devText: {
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
    fontFamily: font.mono,
    lineHeight: tokens.lineHeight.sm,
  },
  retryButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...tokens.shadow.accent,
  },
  retryButtonPressed: {
    opacity: 0.85,
  },
  retryText: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.base,
    color: tokens.color.onEmerald,
  },
});
