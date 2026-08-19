// AmountInput — the primary currency entry control for placing a bet or
// creating a subject wager. Sanitizes every keystroke into a value that is
// always a valid decimal amount (single decimal point, max 2 decimal
// places, no leading zeros) so whatever reaches the API is guaranteed
// parseable — the caller never has to defend against a malformed string.
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, radius, spacing, tokens } from '../theme';
import { tapLight } from '../utils/haptics';
import { formatMoney } from '../utils/format';

export interface AmountInputProps {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  error?: string;
  /** Server-side transaction cap (e.g. 500). Entering more shows an inline error. */
  max?: number;
  quickAmounts?: number[];
  /** The user's current balance, if relevant — renders "Available: $X.XX". */
  available?: number;
  editable?: boolean;
}

/** Strips a raw keystroke buffer down to a valid decimal-amount string. */
function sanitizeAmount(raw: string): string {
  let digits = '';
  let seenDot = false;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      digits += ch;
    } else if (ch === '.' && !seenDot) {
      digits += ch;
      seenDot = true;
    }
  }

  const [wholeRaw, ...rest] = digits.split('.');
  let whole = wholeRaw.replace(/^0+(?=\d)/, '');
  if (whole === '' && (digits.includes('.') || digits.startsWith('0'))) {
    whole = '0';
  }

  let result = whole;
  if (rest.length > 0) {
    result += '.' + rest.join('').slice(0, 2);
  }
  return result;
}

export function AmountInput({
  value,
  onChangeText,
  label = 'Amount',
  error,
  max,
  quickAmounts,
  available,
  editable = true,
}: AmountInputProps) {
  const numericValue = parseFloat(value);
  const hasNumericValue = value.length > 0 && !isNaN(numericValue);
  const overMax = max !== undefined && hasNumericValue && numericValue > max;
  const overAvailable = available !== undefined && hasNumericValue && numericValue > available;
  const fmt = formatMoney;

  const derivedError =
    error ??
    (overMax
      ? `Max amount is ${fmt(max!)}`
      : overAvailable
        ? 'Exceeds available balance'
        : undefined);

  const handleQuickAmount = (amount: number) => {
    tapLight();
    onChangeText(String(amount));
  };

  return (
    <View style={styles.container}>
      {label ? (
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.inputWrap,
          derivedError && styles.inputWrapError,
          !editable && styles.inputWrapDisabled,
        ]}
      >
        <Text style={styles.prefix}>$</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={(raw) => onChangeText(sanitizeAmount(raw))}
          placeholder="0"
          placeholderTextColor={colors.textFaint}
          keyboardType="decimal-pad"
          editable={editable}
          accessibilityLabel={label}
          maxLength={9}
        />
      </View>

      {quickAmounts && quickAmounts.length > 0 ? (
        <View style={styles.quickRow}>
          {quickAmounts.map((amount) => {
            const chipLabel = `$${amount}`;
            return (
              <Pressable
                key={amount}
                onPress={() => handleQuickAmount(amount)}
                accessibilityRole="button"
                accessibilityLabel={chipLabel}
                style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
              >
                <Text style={styles.chipText}>{chipLabel}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={styles.footerRow}>
        {derivedError ? (
          <Text style={styles.errorText} numberOfLines={2}>
            {derivedError}
          </Text>
        ) : available !== undefined ? (
          <Text style={styles.availableText}>Available: {fmt(available)}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  label: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
  },
  inputWrapError: {
    borderColor: tokens.color.crimson,
  },
  inputWrapDisabled: {
    opacity: 0.55,
  },
  prefix: {
    fontFamily: font.monoMedium,
    fontSize: tokens.fontSize['3xl'],
    color: colors.textMuted,
    marginRight: spacing.xs,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: font.monoMedium,
    fontSize: tokens.fontSize['3xl'],
    color: colors.text,
    fontVariant: ['tabular-nums'],
    paddingVertical: spacing.sm,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipPressed: {
    backgroundColor: colors.brandFill,
    borderColor: colors.brand2,
  },
  chipText: {
    fontFamily: font.monoMedium,
    fontSize: tokens.fontSize.sm,
    color: colors.text,
  },
  footerRow: {
    marginTop: spacing.xs,
    minHeight: 16,
  },
  errorText: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.xs,
    color: colors.rose,
  },
  availableText: {
    fontFamily: font.mono,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
  },
});
