// Button — the one tappable-rectangle primitive every screen should reach
// for instead of rolling its own TouchableOpacity + LinearGradient combo.
// Four variants map onto the semantic tokens in theme.ts so "danger" always
// means the same red everywhere, etc.
import React, { useMemo } from 'react';
import { Pressable, Text, View, ActivityIndicator, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, tokens } from '../theme';
import * as haptics from '../utils/haptics';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonHaptic = 'light' | 'medium' | 'success' | 'none';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  haptic?: ButtonHaptic;
  style?: StyleProp<ViewStyle>;
}

const SIZE_HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 44, lg: 52 };
const SIZE_PADDING_H: Record<ButtonSize, number> = { sm: spacing.md, md: spacing.lg, lg: spacing.xl };
const SIZE_FONT: Record<ButtonSize, number> = { sm: tokens.fontSize.sm, md: tokens.fontSize.base, lg: tokens.fontSize.base };
const SIZE_ICON: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

function fireHaptic(kind: ButtonHaptic) {
  if (kind === 'light') haptics.tapLight();
  else if (kind === 'medium') haptics.tapMedium();
  else if (kind === 'success') haptics.success();
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  fullWidth = false,
  haptic = 'light',
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const variantStyle = VARIANT_STYLES[variant];
  const textColor = isDisabled ? variantStyle.textDisabled ?? variantStyle.text : variantStyle.text;

  // `sm` buttons are visually shorter than the 44pt gate, so we grow the hit
  // area with hitSlop instead of inflating the box itself.
  const hitSlop = useMemo(() => {
    const shortfall = Math.max(0, 44 - SIZE_HEIGHT[size]);
    return shortfall > 0 ? Math.ceil(shortfall / 2) : undefined;
  }, [size]);

  const handlePress = () => {
    if (isDisabled) return;
    if (haptic !== 'none') fireHaptic(haptic);
    onPress();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={handlePress}
      disabled={isDisabled}
      hitSlop={hitSlop}
      style={({ pressed }) => [
        styles.base,
        variantStyle.container,
        {
          height: SIZE_HEIGHT[size],
          minWidth: 44,
          paddingHorizontal: SIZE_PADDING_H[size],
        },
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {/* Loading swaps the label for a spinner but the row below keeps the
          same layout slot so the button never changes width mid-tap. */}
      <View style={[styles.content, loading && styles.contentHidden]}>
        {icon && iconPosition === 'left' && (
          <Ionicons name={icon} size={SIZE_ICON[size]} color={textColor} style={styles.iconLeft} />
        )}
        <Text
          style={[styles.label, { color: textColor, fontSize: SIZE_FONT[size] }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {title}
        </Text>
        {icon && iconPosition === 'right' && (
          <Ionicons name={icon} size={SIZE_ICON[size]} color={textColor} style={styles.iconRight} />
        )}
      </View>
      {loading && (
        <View style={styles.spinnerOverlay} pointerEvents="none">
          <ActivityIndicator size="small" color={textColor} />
        </View>
      )}
    </Pressable>
  );
}

export default Button;

const VARIANT_STYLES: Record<
  ButtonVariant,
  { container: ViewStyle; text: string; textDisabled?: string }
> = {
  primary: {
    container: { backgroundColor: colors.brand, ...tokens.shadow.accent },
    text: tokens.color.textInverse,
  },
  secondary: {
    container: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    text: colors.text,
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    text: colors.brand,
  },
  danger: {
    container: { backgroundColor: colors.roseFill, borderWidth: 1, borderColor: colors.rose },
    text: colors.rose,
  },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.85,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
  },
  contentHidden: {
    opacity: 0,
  },
  spinnerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '600',
    flexShrink: 1,
  },
  iconLeft: {
    marginRight: spacing.xs,
  },
  iconRight: {
    marginLeft: spacing.xs,
  },
});
