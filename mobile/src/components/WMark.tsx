// WMark — WagerPals' play-currency glyph. A "W" with a single thin
// vertical stroke through its center. No unicode equivalent exists; this is
// a brand asset (see W-CURRENCY-SPEC.md). Web renders the same idea as an
// inline SVG (components/WMark.tsx); RN has no cheap SVG-free equivalent so
// this layers a <Text>W</Text> with an absolutely positioned vertical bar
// <View> through its center — no new native deps.
//
// The mark inherits color (passed explicitly, since RN has no
// `currentColor`) and is sized by `size` (a font-size-equivalent number).
// `WAmount` pairs the mark with mono digits for an actual W-denominated
// figure — the play-money counterpart to <Money>/<WMark> is to <Money> as
// `formatW` (utils/format.ts) is to `formatMoney`.
import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { colors, font, tokens } from '../theme';
import { formatW } from '../utils/format';

export interface WMarkProps {
  /** Font-size-equivalent size in px. Defaults to the base body size. */
  size?: number;
  /** Explicit color — RN has no currentColor, so this must be passed. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export const WMark = React.memo(function WMark({ size = tokens.fontSize.base, color = colors.text, style }: WMarkProps) {
  // Bar is ~1.5 theme-units wide at body size (16px -> ~1.5px), scaling with
  // size, and overshoots the glyph's cap height slightly above/below —
  // mirrors the web SVG's ~8%-width stroke extending ~15% past the glyph.
  const barWidth = Math.max(1, size * 0.09);
  const overshoot = size * 0.16;

  return (
    <View
      style={[
        { width: size * 0.86, height: size * 1.2, alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        style={{
          fontFamily: font.monoMedium,
          fontSize: size,
          lineHeight: size * 1.2,
          color,
          textAlign: 'center',
        }}
      >
        W
      </Text>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -overshoot,
          bottom: -overshoot,
          left: '50%',
          marginLeft: -barWidth / 2,
          width: barWidth,
          backgroundColor: color,
        }}
      />
    </View>
  );
});

export type WAmountSize = 'sm' | 'md' | 'lg';
// 'auto' colors by sign (emerald positive / crimson negative), same rule as
// <Money>. Amber is never a valid tone here — W is money, not a person.
export type WAmountTone = 'auto' | 'neutral';

export interface WAmountProps {
  value: number;
  size?: WAmountSize;
  /** Prefix positive amounts with "+". Negative amounts always show "-". */
  signed?: boolean;
  tone?: WAmountTone;
  /**
   * Explicit color override (e.g. matching a side's emerald/crimson dot)
   * — takes precedence over `tone`. WAmount renders a WMark + Text pair
   * inside a row View, so a `color` prop is the only way to recolor it;
   * RN Text doesn't inherit color from an ancestor View the way it does
   * from an ancestor Text.
   */
  color?: string;
  /** Applies to the row container (layout only) — use `color` to recolor the amount, not a text style override. */
  style?: StyleProp<ViewStyle>;
}

const SIZE_FONT: Record<WAmountSize, number> = {
  sm: tokens.fontSize.sm,
  md: tokens.fontSize.base,
  lg: tokens.fontSize['2xl'],
};

export const WAmount = React.memo(function WAmount({ value, size = 'md', signed = false, tone = 'neutral', color: colorOverride, style }: WAmountProps) {
  const fontSize = SIZE_FONT[size];
  const color =
    colorOverride ??
    (tone === 'auto'
      ? value > 0
        ? tokens.color.win
        : value < 0
        ? tokens.color.loss
        : colors.text
      : colors.text);
  const abs = Math.abs(value);
  const digits = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : '';

  return (
    <View
      style={[styles.row, style]}
      accessibilityLabel={formatW(value, { sign: signed })}
    >
      {sign ? <Text style={[styles.text, { fontSize, color }]}>{sign}</Text> : null}
      <WMark size={fontSize} color={color} />
      <Text style={[styles.text, { fontSize, color }]} numberOfLines={1} ellipsizeMode="tail">
        {digits}
      </Text>
    </View>
  );
});

export default WMark;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontFamily: font.monoMedium,
    fontVariant: ['tabular-nums'],
  },
});
