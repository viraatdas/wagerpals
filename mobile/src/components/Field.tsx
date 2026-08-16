// Field — the standard labelled text input for every form screen. Wraps the
// shared `inputStyle` token bundle with an animated focus ring, an inline
// error state that reserves its own vertical space (so surfacing an error
// never shifts layout), and an optional "12/80" character counter.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, easingBezier, inputStyle, radius, spacing, tokens } from '../theme';

export interface FieldProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  multiline?: boolean;
  maxLength?: number;
  showCount?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoCorrect?: boolean;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  inputRef?: React.RefObject<TextInput | null>;
  editable?: boolean;
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  trailingAccessory?: React.ReactNode;
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  hint,
  required,
  multiline,
  maxLength,
  showCount,
  keyboardType,
  autoCapitalize = 'sentences',
  autoCorrect = true,
  returnKeyType,
  onSubmitEditing,
  inputRef,
  editable = true,
  leadingIcon,
  trailingAccessory,
  onFocus,
  onBlur,
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  const focusAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(focusAnim, {
      toValue: focused ? 1 : 0,
      duration: tokens.duration.fast,
      easing: Easing.bezier(...easingBezier.out),
      useNativeDriver: false, // color interpolation is not supported on the native driver
    }).start();
  }, [focused, focusAnim]);

  const borderColor = error
    ? colors.rose
    : focusAnim.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.brand2] });

  return (
    <View style={styles.container}>
      {label ? (
        <Text style={styles.label} numberOfLines={1}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      ) : null}
      <Animated.View
        style={[
          styles.inputWrap,
          multiline && styles.inputWrapMultiline,
          { borderColor },
          !editable && styles.inputWrapDisabled,
        ]}
      >
        {leadingIcon ? (
          <Ionicons name={leadingIcon} size={18} color={colors.textMuted} style={styles.leadingIcon} />
        ) : null}
        <TextInput
          ref={inputRef}
          style={[styles.input, multiline && styles.inputMultiline]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          editable={editable}
          multiline={multiline}
          maxLength={maxLength}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          accessibilityLabel={label ?? placeholder}
        />
        {trailingAccessory ? <View style={styles.trailing}>{trailingAccessory}</View> : null}
      </Animated.View>
      {/* This row always renders (even when both error and hint are absent)
          so the error line reserves its space and never causes a layout jump. */}
      <View style={styles.footerRow}>
        <View style={styles.footerTextWrap}>
          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={14} color={colors.rose} />
              <Text style={styles.errorText} numberOfLines={2}>
                {error}
              </Text>
            </View>
          ) : hint ? (
            <Text style={styles.hintText} numberOfLines={2}>
              {hint}
            </Text>
          ) : null}
        </View>
        {showCount && maxLength ? (
          <Text style={styles.countText}>
            {value.length}/{maxLength}
          </Text>
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
    fontSize: tokens.fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  required: {
    color: colors.rose,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: inputStyle.backgroundColor,
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  inputWrapMultiline: {
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
  },
  inputWrapDisabled: {
    opacity: 0.55,
  },
  leadingIcon: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: inputStyle.fontSize,
    color: inputStyle.color,
    paddingVertical: spacing.sm,
  },
  inputMultiline: {
    minHeight: 100,
    paddingTop: spacing.sm,
  },
  trailing: {
    marginLeft: spacing.sm,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    minHeight: 16,
  },
  footerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  errorText: {
    flexShrink: 1,
    fontSize: tokens.fontSize.xs,
    color: colors.rose,
  },
  hintText: {
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
  },
  countText: {
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
    marginLeft: spacing.sm,
  },
});
