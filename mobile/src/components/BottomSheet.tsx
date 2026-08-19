// BottomSheet — a modal sheet that slides up from the bottom. Animated by
// hand (Modal's animationType="none") so the motion uses the app's own
// duration/easing tokens instead of the platform default. Tapping the
// backdrop closes it; content is wrapped in KeyboardAvoidingView so a
// text input inside the sheet (see UserPicker's search box) is never
// covered by the keyboard.
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, easingBezier, font, radius, spacing, tokens } from '../theme';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** When true, the sheet hugs its content instead of capping at 85% of screen height. */
  snapToContent?: boolean;
}

// Comfortably larger than any real screen height, so the sheet starts fully
// off-screen regardless of device size.
const SLIDE_DISTANCE = 900;
// Peak backdrop opacity — kept well under 1 so it reads as a dim, not a
// blackout; the color itself must stay a theme token (`colors.text`), so
// darkness is tuned via this animated opacity value instead of an rgba literal.
const BACKDROP_OPACITY = 0.4;

export function BottomSheet({ visible, onClose, title, children, snapToContent }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const translateY = useRef(new Animated.Value(SLIDE_DISTANCE)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: tokens.duration.base,
          easing: Easing.bezier(...easingBezier.out),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: BACKDROP_OPACITY,
          duration: tokens.duration.base,
          easing: Easing.bezier(...easingBezier.out),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SLIDE_DISTANCE,
          duration: tokens.duration.fast,
          easing: Easing.bezier(...easingBezier.inOut),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: tokens.duration.fast,
          easing: Easing.bezier(...easingBezier.inOut),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, translateY, backdropOpacity]);

  if (!mounted) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} pointerEvents="none" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
          <Animated.View
            style={[
              styles.sheet,
              !snapToContent && styles.sheetMaxHeight,
              { paddingBottom: insets.bottom + spacing.lg, transform: [{ translateY }] },
            ]}
          >
            <View style={styles.handle} />
            {title ? (
              <View style={styles.titleRow}>
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={8}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.content}>{children}</View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.text,
  },
  kav: {
    width: '100%',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  sheetMaxHeight: {
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.lg,
    color: colors.text,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.md,
  },
  content: {
    paddingBottom: spacing.md,
  },
});
