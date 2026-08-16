// Avatar — circular initials badge. The background color is derived
// deterministically from the username (a stable hash into a fixed palette
// of theme tokens) so the same person always gets the same color across
// screens/sessions without us persisting anything.
import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, tokens } from '../theme';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  username?: string | null;
  size?: AvatarSize;
  style?: StyleProp<ViewStyle>;
}

// Fixed palette of theme tokens only — no ad-hoc hex here.
const PALETTE = [colors.brand, colors.mint, colors.violet, colors.cyan, colors.amber, colors.rose] as const;

const SIZE_PX: Record<AvatarSize, number> = { sm: 28, md: 40, lg: 56 };
const SIZE_FONT: Record<AvatarSize, number> = { sm: tokens.fontSize.xs, md: tokens.fontSize.sm, lg: tokens.fontSize.lg };

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0; // force 32-bit int
  }
  return Math.abs(hash);
}

function getInitials(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return '';
  // Split on whitespace so "Jane Doe" -> "JD"; a single token username
  // (the common case here, e.g. "@jane_doe") -> first two chars.
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export const Avatar = React.memo(function Avatar({ username, size = 'md', style }: AvatarProps) {
  const px = SIZE_PX[size];
  const hasName = !!username && username.trim().length > 0;

  if (!hasName) {
    return (
      <View
        style={[
          styles.base,
          { width: px, height: px, borderRadius: px / 2, backgroundColor: colors.bg2 },
          style,
        ]}
      >
        <Ionicons name="person" size={px * 0.5} color={colors.textFaint} />
      </View>
    );
  }

  const bg = PALETTE[hashString(username!.trim().toLowerCase()) % PALETTE.length];
  const initials = getInitials(username!);

  return (
    <View
      style={[styles.base, { width: px, height: px, borderRadius: px / 2, backgroundColor: bg }, style]}
      accessibilityLabel={`${username} avatar`}
    >
      <Text style={[styles.initials, { fontSize: SIZE_FONT[size] }]} numberOfLines={1}>
        {initials}
      </Text>
    </View>
  );
});

export default Avatar;

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: {
    color: tokens.color.textInverse,
    fontWeight: '700',
  },
});
