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
  TouchableWithoutFeedback,
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
    if (value.trim()) {
      onSubmit(value.trim());
      setValue('');
    }
  };

  const handleCancel = () => {
    setValue('');
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardView}
          >
            <View style={styles.modalContainer}>
              <View style={styles.modalContent}>
                <Text style={styles.title}>{title}</Text>
                {message && <Text style={styles.message}>{message}</Text>}
                
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
                />
                
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.button, styles.cancelButton]}
                    onPress={handleCancel}
                  >
                    <Text style={styles.cancelButtonText}>{cancelText}</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.buttonWrap, !value.trim() && styles.submitButtonDisabled]}
                    onPress={handleSubmit}
                    disabled={!value.trim()}
                  >
                    <LinearGradient
                      colors={gradients.brand}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[styles.button, styles.submitButton]}
                    >
                      <Text style={styles.submitButtonText}>
                        {submitText}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
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
    color: '#fff',
  },
});

