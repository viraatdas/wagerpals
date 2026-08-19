// Avatar — the "human" primitive. Every avatar carries an Amber ring (the
// people accent — never used for money) around an Amber-tinted fill, with a
// single-letter initial. No per-person hue palette anymore: Amber is THE
// avatar color, consistently, everywhere — see DESIGN-SPEC.md's color rule
// ("if it describes a person, it is Amber").
import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { font, tokens } from '../theme';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  username?: string | null;
  size?: AvatarSize;
  style?: StyleProp<ViewStyle>;
}

const SIZE_PX: Record<AvatarSize, number> = { sm: 28, md: 40, lg: 56 };
const SIZE_FONT: Record<AvatarSize, number> = { sm: tokens.fontSize.xs, md: tokens.fontSize.sm, lg: tokens.fontSize.lg };
const SIZE_RING: Record<AvatarSize, number> = { sm: 1.5, md: 2, lg: 2 };

/** Single-letter initial — the fallback glyph is always one character,
 * whether or not a real username is available ("?" when there isn't one),
 * so every avatar reads the same shape at a glance. */
function getInitial(username?: string | null): string {
  const trimmed = username?.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

export const Avatar = React.memo(function Avatar({ username, size = 'md', style }: AvatarProps) {
  const px = SIZE_PX[size];
  const hasName = !!username && username.trim().length > 0;
  const initial = getInitial(username);

  return (
    <View
      style={[
        styles.base,
        {
          width: px,
          height: px,
          borderRadius: px / 2,
          backgroundColor: tokens.color.amberFill,
          borderWidth: SIZE_RING[size],
          borderColor: tokens.color.amber,
        },
        style,
      ]}
      accessibilityLabel={hasName ? `${username} avatar` : 'Avatar'}
    >
      <Text style={[styles.initials, { fontSize: SIZE_FONT[size] }]} numberOfLines={1}>
        {initial}
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
    color: tokens.color.amberInk,
    fontFamily: font.sansSemiBold,
  },
});
