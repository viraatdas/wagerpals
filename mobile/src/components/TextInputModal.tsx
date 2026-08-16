// Custom TextInputModal - Works on both iOS and Android (Alert.prompt is iOS only)
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, radius, glow, inputStyle } from '../theme';

interface TextInputModalProps {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  maxLength?: number;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  submitText?: string;
  cancelText?: string;
  /** Optional loading state — disables both buttons and swaps the submit label for a spinner. */
  loading?: boolean;
}

export default function TextInputModal({
  visible,
  title,
  message,
  placeholder,
  defaultValue = '',
  keyboardType = 'default',
  maxLength,
  onSubmit,
  onCancel,
  submitText = 'Submit',
  cancelText = 'Cancel',
  loading = false,
}: TextInputModalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setValue(defaultValue);
      // Focus input after modal opens
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [visible, defaultValue]);

  const handleSubmit = () => {
    if (loading) return;
    if (value.trim()) {
      onSubmit(value.trim());
      setValue('');
    }
  };

  const handleCancel = () => {
    if (loading) return;
    setValue('');
    onCancel();
  };

  const submitDisabled = !value.trim() || loading;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <View style={styles.overlay}>
        {/* Backdrop is a sibling (not a parent) of the content so its dim
            opacity never bleeds onto the modal card itself. */}
        <Pressable
          style={styles.backdrop}
          onPress={() => Keyboard.dismiss()}
          accessibilityRole="button"
          accessibilityLabel="Dismiss keyboard"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
                {title}
              </Text>
              {message && (
                <Text style={styles.message} numberOfLines={4}>
                  {message}
                </Text>
              )}

              <TextInput
                ref={inputRef}
                style={styles.input}
                value={value}
                onChangeText={setValue}
                placeholder={placeholder}
                placeholderTextColor={colors.textFaint}
                keyboardType={keyboardType}
                maxLength={maxLength}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handleSubmit}
                returnKeyType="done"
                editable={!loading}
                accessibilityLabel={placeholder ?? title}
              />

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton]}
                  onPress={handleCancel}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel={cancelText}
                  accessibilityState={{ disabled: loading }}
                >
                  <Text style={styles.cancelButtonText}>{cancelText}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.buttonWrap, submitDisabled && styles.submitButtonDisabled]}
                  onPress={handleSubmit}
                  disabled={submitDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={submitText}
                  accessibilityState={{ disabled: submitDisabled, busy: loading }}
                >
                  <LinearGradient
                    colors={gradients.brand}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.button, styles.submitButton]}
                  >
                    {loading ? (
                      <ActivityIndicator color={colors.white} size="small" />
                    ) : (
                      <Text style={styles.submitButtonText}>{submitText}</Text>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // A dim scrim behind the card. Kept token-only (no rgba literal) by using
  // a dark theme color at reduced opacity instead of baking translucency
  // into the color itself.
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.text,
    opacity: 0.4,
  },
  keyboardView: {
    width: '100%',
    alignItems: 'center',
  },
  modalContainer: {
    width: '85%',
    maxWidth: 340,
  },
  modalContent: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 24,
    ...glow(colors.brand3, 0.25),
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  input: {
    ...inputStyle,
    height: 52,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonWrap: {
    flex: 1,
  },
  cancelButton: {
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textMuted,
  },
  submitButton: {
    ...glow(colors.brand2, 0.45),
  },
  submitButtonDisabled: {
    opacity: 0.45,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
  },
});

