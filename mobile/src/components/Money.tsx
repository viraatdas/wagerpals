// Money — renders a currency amount with consistent formatting and
// win/loss coloring. Columns of these line up thanks to tabular-nums.
//
// TODO(lead): switch to utils/format.formatMoney once available
import React from 'react';
import { Text, StyleSheet, StyleProp, TextStyle } from 'react-native';
import { colors, tokens } from '../theme';

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
  const abs = Math.abs(amount).toFixed(2);
  const sign = amount < 0 ? '-' : signed && amount > 0 ? '+' : '';
  return `${sign}$${abs}`;
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
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
