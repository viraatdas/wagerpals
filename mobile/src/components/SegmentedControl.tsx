// SegmentedControl — an iOS-style sunken track with a sliding selected
// thumb. Used for side A/B pick and payment type (Free/Cash). Generic over
// the option value type so callers get type-checked `value`/`onChange`.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, spacing, tokens } from '../theme';
import { selectionTick } from '../utils/haptics';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Optional semantic tint applied to the label/icon when this segment is selected. */
  tone?: 'mint' | 'rose' | 'brand';
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}

const TONE_COLOR = {
  mint: colors.mint,
  rose: colors.rose,
  brand: colors.brand2,
} as const;

const SIZE_HEIGHT = { sm: 36, md: 44 } as const;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: SegmentedControlProps<T>) {
  const [trackWidth, setTrackWidth] = useState(0);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const thumbAnim = useRef(new Animated.Value(selectedIndex)).current;
  const segmentWidth = options.length > 0 ? trackWidth / options.length : 0;
  const height = SIZE_HEIGHT[size];
  // `sm` tracks are shorter than the 44pt tap-target gate, so segments grow
  // their hit area with hitSlop instead of inflating the visual track.
  const verticalHitSlop = Math.max(0, Math.ceil((44 - height) / 2));

  useEffect(() => {
    Animated.spring(thumbAnim, {
      toValue: selectedIndex,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  }, [selectedIndex, thumbAnim]);

  const handleLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <View style={[styles.track, { height }]} onLayout={handleLayout}>
      {trackWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              width: segmentWidth,
              height: height - spacing.xs,
              transform: [
                {
                  translateX: thumbAnim.interpolate({
                    inputRange: options.map((_, i) => i),
                    outputRange: options.map((_, i) => i * segmentWidth),
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        const tintColor = option.tone ? TONE_COLOR[option.tone] : colors.text;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (option.value !== value) {
                selectionTick();
                onChange(option.value);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            style={styles.segment}
            hitSlop={{ top: verticalHitSlop, bottom: verticalHitSlop, left: 0, right: 0 }}
          >
            {option.icon ? (
              <Ionicons
                name={option.icon}
                size={14}
                color={selected ? tintColor : colors.textMuted}
                style={styles.segmentIcon}
              />
            ) : null}
            <Text
              numberOfLines={1}
              style={[
                styles.segmentLabel,
                { color: selected ? tintColor : colors.textMuted },
                selected && styles.segmentLabelSelected,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.bg2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs / 2,
    position: 'relative',
  },
  thumb: {
    position: 'absolute',
    top: spacing.xs / 2,
    left: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: tokens.shadow.elev1.shadowColor,
    shadowOffset: tokens.shadow.elev1.shadowOffset,
    shadowOpacity: tokens.shadow.elev1.shadowOpacity,
    shadowRadius: tokens.shadow.elev1.shadowRadius,
    elevation: tokens.shadow.elev1.elevation,
  },
  segment: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  segmentIcon: {},
  segmentLabel: {
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.sm,
  },
  segmentLabelSelected: {
    fontFamily: font.sansSemiBold,
  },
});
