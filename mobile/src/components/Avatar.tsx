// Avatar — the "human" primitive. A standalone avatar carries an Amber ring
// (the people accent — never used for money) around an Amber-tinted fill,
// with a single-letter initial. Amber still identifies "this is a person"
// everywhere via that fill/initial — see DESIGN-SPEC.md's color rule ("if
// it describes a person, it is Amber") — but once an avatar sits inside an
// overlapping cluster, its ring switches to `ringColor` (a card/surface
// cutout separator between circles) so two heavy amber rings don't mush
// together; pass `ringColor` from the cluster's own background color.
import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { font, tokens } from '../theme';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  username?: string | null;
  /** Real photo (Google's, or a custom upload) — falls back to the amber
   * initial on load failure or when absent. */
  avatarUrl?: string | null;
  size?: AvatarSize;
  /** Ring color override — pass the surrounding surface's color (e.g.
   * colors.surface) when this avatar overlaps another one in a cluster.
   * Defaults to the amber identity ring for a standalone avatar. */
  ringColor?: string;
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

export const Avatar = React.memo(function Avatar({ username, avatarUrl, size = 'md', ringColor, style }: AvatarProps) {
  const px = SIZE_PX[size];
  const hasName = !!username && username.trim().length > 0;
  const initial = getInitial(username);
  // A load failure (bad URL, network hiccup, revoked Google photo) falls
  // back to the initial rather than an empty/broken image — reset whenever
  // the source URL itself changes so a fixed avatar_url gets a fresh try.
  const [loadFailed, setLoadFailed] = useState(false);
  const showImage = !!avatarUrl && !loadFailed;

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
          borderColor: ringColor ?? tokens.color.amber,
        },
        style,
      ]}
      accessibilityLabel={hasName ? `${username} avatar` : 'Avatar'}
    >
      {showImage ? (
        <Image
          source={{ uri: avatarUrl as string }}
          style={{ width: px, height: px, borderRadius: px / 2 }}
          onError={() => setLoadFailed(true)}
          key={avatarUrl}
        />
      ) : (
        <Text style={[styles.initials, { fontSize: SIZE_FONT[size] }]} numberOfLines={1}>
          {initial}
        </Text>
      )}
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
