// Card — the canonical white, hairline-bordered surface. Wraps theme's
// `glass.card` / `glass.cardStrong` fragments so every card in the app gets
// the same border/shadow recipe instead of screens hand-rolling it.
import React from 'react';
import { View, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { glass, spacing } from '../theme';
import { tapLight } from '../utils/haptics';

export interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Uses the slightly stronger shadow/radius (glass.cardStrong) for cards
   * that need to visually pop off a busy background. */
  elevated?: boolean;
  /** Applies the standard internal padding. Defaults to true — pass false
   * when the content manages its own padding (e.g. a full-bleed image). */
  padded?: boolean;
  accessibilityLabel?: string;
}

export function Card({ children, onPress, style, elevated = false, padded = true, accessibilityLabel }: CardProps) {
  const shell = elevated ? glass.cardStrong : glass.card;

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={() => {
          tapLight();
          onPress();
        }}
        style={({ pressed }) => [
          shell,
          padded && styles.padded,
          pressed && styles.pressed,
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[shell, padded && styles.padded, style]}>{children}</View>;
}

export default Card;

const styles = StyleSheet.create({
  padded: {
    padding: spacing.lg,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
  },
});
