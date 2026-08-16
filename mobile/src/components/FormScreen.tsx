// FormScreen — the keyboard-safe shell every form screen renders inside.
// This is the single fix for "keyboard covers the focused input": a
// KeyboardAvoidingView wraps a ScrollView that always leaves enough bottom
// padding to clear both the safe-area home indicator and an optional sticky
// footer (e.g. a submit button), so the last field is never hidden behind
// either. Screens should stop rolling their own KeyboardAvoidingView +
// ScrollView pair and use this instead.
import React, { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  TextInput,
  View,
  ViewStyle,
  findNodeHandle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';

// Native-stack headers on iOS are ~44pt tall; add a little breathing room so
// KeyboardAvoidingView's padding math doesn't fight the header. Screens
// presented without a header, or that need a different offset, can override
// via `keyboardOffset`.
const DEFAULT_KEYBOARD_OFFSET = Platform.OS === 'ios' ? 90 : 0;

export interface FormScreenProps {
  children: React.ReactNode;
  /** Sticky content pinned above the keyboard/home indicator, e.g. a submit button. */
  footer?: React.ReactNode;
  /** Expose the ScrollView ref to the parent screen, e.g. to drive `useScrollToFocusedInput`. */
  scrollRef?: React.RefObject<ScrollView | null>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Override the KeyboardAvoidingView vertical offset (defaults to a sensible header height). */
  keyboardOffset?: number;
}

export function FormScreen({
  children,
  footer,
  scrollRef,
  contentContainerStyle,
  keyboardOffset,
}: FormScreenProps) {
  const insets = useSafeAreaInsets();
  const internalRef = useRef<ScrollView>(null);
  const resolvedRef = scrollRef ?? internalRef;
  // Measured so the scroll content padding always clears the footer, however
  // tall it ends up being (a one-line vs. two-line button, etc).
  const [footerHeight, setFooterHeight] = useState(0);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardOffset ?? DEFAULT_KEYBOARD_OFFSET}
    >
      <ScrollView
        ref={resolvedRef}
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + footerHeight + spacing.xl },
          contentContainerStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {footer ? (
        <View
          style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}
          onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
        >
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/**
 * Returns `scrollToInput(inputRef)`, for wiring to a field's `onFocus` so the
 * focused input scrolls into view above the keyboard. Pass the same ref you
 * gave `FormScreen`'s `scrollRef`.
 */
export function useScrollToFocusedInput(scrollRef: React.RefObject<ScrollView | null>) {
  return useCallback(
    (inputRef: React.RefObject<TextInput | null>, extraOffset: number = spacing.xl) => {
      const scrollNode = scrollRef.current;
      const inputNode = inputRef.current;
      if (!scrollNode || !inputNode) return;
      const scrollHandle = findNodeHandle(scrollNode);
      if (!scrollHandle) return;
      // measureLayout reports the input's y position relative to the
      // ScrollView's content — exactly what scrollTo needs.
      inputNode.measureLayout(
        scrollHandle,
        (_x: number, y: number) => {
          scrollNode.scrollTo({ y: Math.max(y - extraOffset, 0), animated: true });
        },
        () => {
          // Layout not ready (e.g. input not yet mounted) — safe to ignore,
          // the user can scroll manually.
        }
      );
    },
    [scrollRef]
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  footer: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
});
