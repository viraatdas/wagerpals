// Pill — small status/label chip ("Resolved", "Escrow held", "Late",
// "Quiet bet", "Admin", "Pending"...). Fully rounded per DESIGN-SPEC shape
// language (pills are reserved for people/state, never primary actions),
// label set in mono uppercase — the same small-caps ticker treatment as the
// web status pill. Each tone pairs a `*Fill` background token with its
// text-safe *Ink counterpart for text/icon so chips stay legible without
// ever hardcoding a color.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, spacing, tokens } from '../theme';

export type PillTone = 'neutral' | 'brand' | 'yes' | 'no' | 'pending' | 'info';
export type PillSize = 'sm' | 'md';

export interface PillProps {
  label: string;
  tone?: PillTone;
  icon?: keyof typeof Ionicons.glyphMap;
  size?: PillSize;
}

const TONE_STYLES: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.bg2, fg: colors.textMuted },
  brand: { bg: colors.brandFill, fg: colors.brand },
  yes: { bg: colors.mintFill, fg: colors.mint },
  no: { bg: colors.roseFill, fg: colors.rose },
  pending: { bg: colors.amberFill, fg: colors.amber },
  info: { bg: colors.cyanFill, fg: colors.cyan },
};

export const Pill = React.memo(function Pill({ label, tone = 'neutral', icon, size = 'md' }: PillProps) {
  const toneStyle = TONE_STYLES[tone];
  const isSmall = size === 'sm';

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: toneStyle.bg },
        isSmall ? styles.sm : styles.md,
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={isSmall ? 11 : 13}
          color={toneStyle.fg}
          style={styles.icon}
        />
      )}
      <Text
        style={[styles.label, { color: toneStyle.fg, fontSize: isSmall ? tokens.fontSize.xs : tokens.fontSize.sm }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label.toUpperCase()}
      </Text>
    </View>
  );
});

export default Pill;

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    flexShrink: 1,
    maxWidth: '100%',
  },
  sm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  md: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  icon: {
    marginRight: 4,
  },
  label: {
    fontFamily: font.monoMedium,
    letterSpacing: 0.4,
    flexShrink: 1,
  },
});
