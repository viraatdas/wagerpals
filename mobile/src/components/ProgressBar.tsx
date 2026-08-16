// ProgressBar — a simple 0..1 fill bar, and SplitBar — a two-tone yes/no
// variant for showing the proportion of each side of a bet. Both animate
// width changes with the native driver disabled (width isn't animatable on
// the native thread), matching the durations/easings used elsewhere.
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { Easing } from 'react-native';
import { colors, radius, spacing, tokens, easingBezier } from '../theme';

export type ProgressTone = 'brand' | 'yes' | 'no' | 'neutral';

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  tone?: ProgressTone;
  height?: number;
  animated?: boolean;
}

const TONE_COLOR: Record<ProgressTone, string> = {
  brand: colors.brand,
  yes: colors.mint,
  no: colors.rose,
  neutral: colors.textFaint,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function ProgressBar({ value, tone = 'brand', height = 8, animated = true }: ProgressBarProps) {
  const widthAnim = useRef(new Animated.Value(clamp01(value))).current;

  useEffect(() => {
    if (animated) {
      Animated.timing(widthAnim, {
        toValue: clamp01(value),
        duration: tokens.duration.base,
        easing: Easing.bezier(...easingBezier.out),
        useNativeDriver: false, // width isn't supported by the native driver
      }).start();
    } else {
      widthAnim.setValue(clamp01(value));
    }
  }, [value, animated, widthAnim]);

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <Animated.View
        style={[
          styles.fill,
          {
            backgroundColor: TONE_COLOR[tone],
            borderRadius: height / 2,
            width: widthAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          },
        ]}
      />
    </View>
  );
}

export interface SplitBarProps {
  aValue: number;
  bValue: number;
  aLabel?: string;
  bLabel?: string;
  height?: number;
}

/** Two-tone bar showing the yes/no (or A/B) split of a bet's total volume. */
export function SplitBar({ aValue, bValue, aLabel, bLabel, height = 8 }: SplitBarProps) {
  const total = aValue + bValue;
  const aRatio = total > 0 ? aValue / total : 0.5;

  return (
    <View style={styles.splitWrap}>
      <View style={[styles.track, styles.splitTrack, { height, borderRadius: height / 2 }]}>
        <View style={[styles.splitSegment, { flex: aRatio || 0.0001, backgroundColor: colors.mint }]} />
        <View style={[styles.splitSegment, { flex: 1 - aRatio || 0.0001, backgroundColor: colors.rose }]} />
      </View>
      {(aLabel || bLabel) && (
        <View style={styles.splitLabels}>
          <Text style={[styles.splitLabel, styles.splitLabelA]} numberOfLines={1} ellipsizeMode="tail">
            {aLabel}
          </Text>
          <Text style={[styles.splitLabel, styles.splitLabelB]} numberOfLines={1} ellipsizeMode="tail">
            {bLabel}
          </Text>
        </View>
      )}
    </View>
  );
}

export default ProgressBar;

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: colors.bg2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
  splitWrap: {
    width: '100%',
  },
  splitTrack: {
    flexDirection: 'row',
  },
  splitSegment: {
    height: '100%',
  },
  splitLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  splitLabel: {
    fontSize: tokens.fontSize.xs,
    color: colors.textMuted,
    flexShrink: 1,
    maxWidth: '48%',
  },
  splitLabelA: {
    textAlign: 'left',
  },
  splitLabelB: {
    textAlign: 'right',
  },
});
