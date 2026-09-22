// Money — renders a currency amount with consistent formatting and
// win/loss coloring. Every number on the board is IBM Plex Mono (never
// above weight 500 — see MOBILE-SPEC.md); Plex Mono is monospaced so
// columns of these line up without needing font-variant-numeric. Emerald
// for positive, crimson-ink for negative — amber never touches money.
//
import React from 'react';
import { Text, StyleSheet, StyleProp, TextStyle } from 'react-native';
import { colors, font, tokens } from '../theme';
import { IS_POINTS, formatPointsNumber, pointsLabel } from '../utils/currency';

export type MoneySize = 'sm' | 'md' | 'lg';
export type MoneyTone = 'auto' | 'neutral';

export interface MoneyProps {
  amount: number;
  size?: MoneySize;
  /** Prefix positive amounts with "+". Negative amounts always show "-". */
  signed?: boolean;
  tone?: MoneyTone;
  style?: StyleProp<TextStyle>;
}

const SIZE_FONT: Record<MoneySize, number> = { sm: tokens.fontSize.sm, md: tokens.fontSize.base, lg: tokens.fontSize['2xl'] };

function formatAmount(amount: number, signed: boolean): string {
  const value = Math.abs(amount);
  const sign = amount < 0 ? '-' : signed && amount > 0 ? '+' : '';
  // This component renders the largest numbers in the app (the wallet balance
  // hero among them), so it must respect the currency mode. It previously had
  // its own hardcoded "$" formatter, which would have left dollar signs all
  // over a points build. See mobile/src/utils/currency.ts.
  if (IS_POINTS) {
    return `${sign}${formatPointsNumber(value)} ${pointsLabel(value)}`;
  }
  return `${sign}$${value.toFixed(2)}`;
}

export const Money = React.memo(function Money({ amount, size = 'md', signed = false, tone = 'auto', style }: MoneyProps) {
  const color =
    tone === 'neutral'
      ? colors.text
      : amount > 0
      ? tokens.color.win
      : amount < 0
      ? tokens.color.loss
      : colors.text;

  return (
    <Text
      style={[
        styles.text,
        { color, fontSize: SIZE_FONT[size] },
        style,
      ]}
      numberOfLines={1}
      ellipsizeMode="tail"
    >
      {formatAmount(amount, signed)}
    </Text>
  );
});

export default Money;

const styles = StyleSheet.create({
  text: {
    fontFamily: font.monoMedium,
    fontVariant: ['tabular-nums'],
  },
});
