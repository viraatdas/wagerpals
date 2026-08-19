// ProgressBar — a simple 0..1 fill bar for generic progress. SplitBar is
// WagerPals' signature element, the confidence bar (see DESIGN-SPEC.md):
// Emerald fill grows from the left edge, Crimson from the right, meeting
// exactly at the split — with mono percent labels at each end (left
// Emerald, right Crimson-ink) and an empty-track "No stakes yet" state when
// the pool is 0, so an unbet event never misreads as an even 50/50 split.
// Both bars animate their fill on FIRST MOUNT ONLY (~400ms ease-out,
// tokens.duration.bar) and instantly snap on any later re-render, and both
// respect the OS reduce-motion setting.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet, Easing, AccessibilityInfo } from 'react-native';
import { colors, font, spacing, tokens, easingBezier } from '../theme';

export type ProgressTone = 'brand' | 'yes' | 'no' | 'neutral';

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  tone?: ProgressTone;
  height?: number;
  animated?: boolean;
}

const TONE_COLOR: Record<ProgressTone, string> = {
  brand: tokens.color.emerald,
  yes: tokens.color.emerald,
  no: tokens.color.crimson,
  neutral: colors.textFaint,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Resolves to `null` until the OS reduce-motion setting is known, then
 * `true`/`false`. Callers should hold off animating until it's non-null so
 * a reduce-motion user never sees a flash of motion before the check
 * resolves. Also listens for the setting changing while mounted. */
function useReduceMotion(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let isMounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (isMounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (isMounted) setReduceMotion(enabled);
    });
    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export function ProgressBar({ value, tone = 'brand', height = 8, animated = true }: ProgressBarProps) {
  const target = clamp01(value);
  const widthAnim = useRef(new Animated.Value(0)).current;
  const mountedOnce = useRef(false);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion === null) return; // hold off until the setting is known
    const shouldAnimate = animated && !reduceMotion && !mountedOnce.current;
    if (shouldAnimate) {
      Animated.timing(widthAnim, {
        toValue: target,
        duration: tokens.duration.bar,
        easing: Easing.bezier(...easingBezier.out),
        useNativeDriver: false, // width isn't supported by the native driver
      }).start();
    } else {
      widthAnim.setValue(target);
    }
    mountedOnce.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, animated, reduceMotion]);

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

/** The confidence bar. Two-tone split showing how a group is leaning on a
 * wager. Emerald fill grows in from the left, Crimson from the right,
 * meeting exactly at the split on first mount (~400ms ease-out); percent
 * labels sit above each end in mono (left Emerald, right Crimson-ink). A
 * zero pool renders a flat neutral track with "No stakes yet" rather than
 * a misleading 50/50 split. */
export function SplitBar({ aValue, bValue, aLabel, bLabel, height = 8 }: SplitBarProps) {
  const total = aValue + bValue;
  const hasStakes = total > 0;
  const aPct = hasStakes ? Math.round((aValue / total) * 100) : 0;
  const bPct = hasStakes ? 100 - aPct : 0;

  const progress = useRef(new Animated.Value(0)).current;
  const mountedOnce = useRef(false);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion === null) return; // hold off until the setting is known
    const shouldAnimate = !reduceMotion && !mountedOnce.current && hasStakes;
    if (shouldAnimate) {
      Animated.timing(progress, {
        toValue: 1,
        duration: tokens.duration.bar,
        easing: Easing.bezier(...easingBezier.out),
        useNativeDriver: false, // width isn't supported by the native driver
      }).start();
    } else {
      progress.setValue(1);
    }
    mountedOnce.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aPct, bPct, hasStakes, reduceMotion]);

  const aWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${aPct}%`] });
  const bWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${bPct}%`] });

  return (
    <View style={styles.splitWrap}>
      {/* Label row keeps the same slot in both states so card layouts don't
          shift: percents when there's money, a single muted "No stakes yet"
          when there isn't. (The label must NOT live inside the track — the
          track is ~8px tall with overflow:hidden, which clips any text.) */}
      <View style={styles.pctRow}>
        {hasStakes ? (
          <>
            <Text style={[styles.pctLabel, styles.pctLabelLeft]}>{aPct}%</Text>
            <Text style={[styles.pctLabel, styles.pctLabelRight]}>{bPct}%</Text>
          </>
        ) : (
          <Text style={styles.emptyLabel} numberOfLines={1}>
            No stakes yet
          </Text>
        )}
      </View>

      {hasStakes ? (
        <View style={[styles.track, styles.splitTrack, { height, borderRadius: height / 2 }]}>
          <Animated.View
            style={[
              styles.splitFillLeft,
              { width: aWidth, backgroundColor: tokens.color.emerald, borderRadius: height / 2 },
            ]}
          />
          <Animated.View
            style={[
              styles.splitFillRight,
              { width: bWidth, backgroundColor: tokens.color.crimson, borderRadius: height / 2 },
            ]}
          />
        </View>
      ) : (
        <View style={[styles.track, { height, borderRadius: height / 2 }, styles.trackEmpty]} />
      )}

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
    position: 'relative',
  },
  splitFillLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  splitFillRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
  },
  trackEmpty: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    fontFamily: font.mono,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
  },
  pctRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs / 2,
  },
  pctLabel: {
    fontFamily: font.monoMedium,
    fontSize: tokens.fontSize.xs,
  },
  pctLabelLeft: {
    color: tokens.color.emerald,
  },
  pctLabelRight: {
    color: tokens.color.crimsonInk,
  },
  splitLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  splitLabel: {
    fontFamily: font.sans,
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
