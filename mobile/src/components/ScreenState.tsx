// ScreenState — the three states every data-driven screen needs: loading,
// empty, error. Sharing one visual shell keeps them from drifting apart.
//
// NOTE on FlatList usage: none of these assume `flex: 1` — they size to
// their content (with `compact` trimming vertical padding for tight spots).
// When passing one of these as a FlatList's `ListEmptyComponent`, give the
// list `contentContainerStyle={{ flexGrow: 1 }}` yourself so the state can
// still center vertically in the available space.
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, tokens } from '../theme';
import { Button } from './Button';

interface ShellProps {
  icon?: keyof typeof Ionicons.glyphMap;
  iconTone?: 'brand' | 'warning';
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

function StateShell({ icon, iconTone = 'brand', title, message, actionLabel, onAction, compact, style, children }: ShellProps) {
  const chipBg = iconTone === 'warning' ? colors.amberFill : colors.brandFill;
  const iconColor = iconTone === 'warning' ? colors.amber : colors.brand;

  return (
    <View style={[styles.shell, compact ? styles.shellCompact : styles.shellRoomy, style]}>
      {children ? (
        children
      ) : (
        <>
          {icon ? (
            <View style={[styles.iconChip, { backgroundColor: chipBg }]}>
              <Ionicons name={icon} size={28} color={iconColor} />
            </View>
          ) : null}
          {title ? (
            <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
              {title}
            </Text>
          ) : null}
          <Text style={styles.message} numberOfLines={3} ellipsizeMode="tail">
            {message}
          </Text>
          {actionLabel && onAction ? (
            <Button title={actionLabel} onPress={onAction} variant="primary" size="md" style={styles.action} />
          ) : null}
        </>
      )}
    </View>
  );
}

export interface LoadingStateProps {
  label?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function LoadingState({ label, compact, style }: LoadingStateProps) {
  return (
    <View style={[styles.shell, compact ? styles.shellCompact : styles.shellRoomy, style]}>
      <ActivityIndicator size="large" color={colors.brand} />
      {label ? (
        <Text style={[styles.message, styles.loadingLabel]} numberOfLines={2} ellipsizeMode="tail">
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({ icon, title, message, actionLabel, onAction, compact, style }: EmptyStateProps) {
  return (
    <StateShell
      icon={icon}
      iconTone="brand"
      title={title}
      message={message}
      actionLabel={actionLabel}
      onAction={onAction}
      compact={compact}
      style={style}
    />
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, retryLabel = 'Try again', compact, style }: ErrorStateProps) {
  return (
    <StateShell
      icon="alert-circle-outline"
      iconTone="warning"
      title={title}
      message={message}
      actionLabel={onRetry ? retryLabel : undefined}
      onAction={onRetry}
      compact={compact}
      style={style}
    />
  );
}

export default { LoadingState, EmptyState, ErrorState };

const styles = StyleSheet.create({
  shell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  shellRoomy: {
    paddingVertical: spacing.xxl,
  },
  shellCompact: {
    paddingVertical: spacing.lg,
  },
  iconChip: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: tokens.fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: tokens.lineHeight.base,
    maxWidth: 320,
  },
  loadingLabel: {
    marginTop: spacing.md,
  },
  action: {
    marginTop: spacing.xl,
  },
});
