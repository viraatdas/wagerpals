// Toggle — a full-row switch control (title + optional description on the
// left, native Switch on the right) where the WHOLE row is tappable, not
// just the tiny switch hit-target. Used for the notify-subject toggle and
// the notification-preferences screen.
import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, font, spacing, tokens } from '../theme';
import { tapLight } from '../utils/haptics';

export interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ value, onValueChange, label, description, disabled }: ToggleProps) {
  const toggle = () => {
    if (disabled) return;
    tapLight();
    onValueChange(!value);
  };

  return (
    <Pressable
      onPress={toggle}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
    >
      <View style={styles.textWrap}>
        {label ? (
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        {description ? (
          <Text style={styles.description} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {/* pointerEvents="none" so a tap anywhere on the row — including
          directly on the switch — is handled once by the outer Pressable,
          instead of double-firing (native Switch + row onPress). */}
      <Switch
        value={value}
        onValueChange={toggle}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.brand2 }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.border}
        pointerEvents="none"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.base,
    color: colors.text,
  },
  description: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    marginTop: spacing.xs / 2,
  },
});
