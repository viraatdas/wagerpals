// SectionHeader — the label that introduces a group of cards/rows
// ("Settings", "Recent Activity", ...). One consistent treatment: a bold
// title at fontSize.lg, plus an optional muted subtitle and a right-aligned
// text action (e.g. "See all").
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, tokens } from '../theme';
import { tapLight } from '../utils/haptics';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, subtitle, actionLabel, onAction }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.textCol}>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2} ellipsizeMode="tail">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={() => {
            tapLight();
            onAction();
          }}
          hitSlop={8}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={styles.actionText} numberOfLines={1}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default SectionHeader;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  title: {
    fontSize: tokens.fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  subtitle: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: tokens.lineHeight.sm,
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPressed: {
    opacity: 0.6,
  },
  actionText: {
    fontSize: tokens.fontSize.sm,
    fontWeight: '600',
    color: colors.brand,
  },
});
