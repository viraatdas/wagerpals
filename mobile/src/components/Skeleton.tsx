// Skeleton — shimmer placeholder used while data loads, so the real content
// doesn't cause a layout jump when it arrives. SkeletonCard/SkeletonList
// intentionally mirror Card's and ListRow's real dimensions (padding,
// avatar size, row height) — keep them in sync if those change.
import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors, radius, spacing, tokens, easingBezier, glass } from '../theme';

export interface SkeletonProps {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width, height, radius: cornerRadius = radius.sm, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: tokens.duration.slower,
          easing: Easing.bezier(...easingBezier.inOut),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: tokens.duration.slower,
          easing: Easing.bezier(...easingBezier.inOut),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.base,
        { width, height, borderRadius: cornerRadius, opacity },
        style,
      ]}
    />
  );
}

/** Mirrors Card's default padded shell (glass.card + spacing.lg padding)
 * with a title line, a subtitle line, and a value line — matches a typical
 * summary/stat card so it doesn't jump when real content swaps in. */
export function SkeletonCard() {
  return (
    <View style={[glass.card, styles.cardPadding]}>
      <Skeleton width="50%" height={14} style={styles.gapSm} />
      <Skeleton width="80%" height={20} style={styles.gapMd} />
      <Skeleton width="35%" height={14} />
    </View>
  );
}

/** Mirrors ListRow's shape: a leading avatar-sized circle, a title/subtitle
 * stack, and a trailing chip — repeated `count` times with hairline
 * separators, matching ListRow's real border/height so a list of rows
 * doesn't reflow when data arrives. */
export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.listRow}>
          <Skeleton width={40} height={40} radius={20} style={styles.listAvatar} />
          <View style={styles.listTextCol}>
            <Skeleton width="60%" height={16} style={styles.gapXs} />
            <Skeleton width="40%" height={12} />
          </View>
          <Skeleton width={44} height={20} radius={radius.sm} />
        </View>
      ))}
    </View>
  );
}

export default Skeleton;

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.bg2,
  },
  cardPadding: {
    padding: spacing.lg,
  },
  gapSm: {
    marginBottom: spacing.sm,
  },
  gapMd: {
    marginBottom: spacing.md,
  },
  gapXs: {
    marginBottom: spacing.xs,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listAvatar: {
    marginRight: spacing.md,
  },
  listTextCol: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.md,
  },
});
