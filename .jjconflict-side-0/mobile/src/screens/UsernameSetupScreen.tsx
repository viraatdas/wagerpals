// Username setup screen - Modern iOS design
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { validateUsername } from '../utils/helpers';
import { colors, gradients, radius, glow } from '../theme';

interface UsernameSetupScreenProps {
  onUsernameSet?: () => void;
}

export default function UsernameSetupScreen({ onUsernameSet }: UsernameSetupScreenProps) {
  const { user } = useAuth();
  const [username, setUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const validation = validateUsername(username);
    if (!validation.valid) {
      setError(validation.error || 'Invalid username');
      return;
    }

    if (!user) return;

    setIsSaving(true);
    setError('');

    try {
      await apiService.setUsername(username.trim());
      // Notify parent that username is set
      if (onUsernameSet) {
        onUsernameSet();
      }
    } catch (error: any) {
      setError(error.message || 'Failed to set username');
    } finally {
      setIsSaving(false);
    }
  };

  const isValid = validateUsername(username).valid;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.iconContainer}
            >
              <Ionicons name="person-add" size={36} color="#fff" />
            </LinearGradient>
            <Text style={styles.title}>Create Your Profile</Text>
            <Text style={styles.subtitle}>
              Choose a username that others will see when you place bets
            </Text>
          </View>

          {/* Form */}
          <View style={styles.card}>
            <Text style={styles.label}>Username</Text>
            <View style={[styles.inputContainer, error && styles.inputContainerError]}>
              <Text style={styles.atSymbol}>@</Text>
              <TextInput
                style={styles.input}
                placeholder="your_username"
                placeholderTextColor={colors.textFaint}
                value={username}
                onChangeText={(text) => {
                  setUsername(text.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                  setError('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                maxLength={20}
              />
              {isValid && (
                <View style={styles.checkIcon}>
                  <Ionicons name="checkmark-circle" size={22} color={colors.mint} />
                </View>
              )}
            </View>

            {error ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={16} color={colors.rose} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : (
              <Text style={styles.hint}>
                2-20 characters • Letters, numbers, underscores
              </Text>
            )}

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={isSaving || !isValid}
              activeOpacity={0.8}
              style={(!isValid || isSaving) && styles.buttonDisabled}
            >
              <LinearGradient
                colors={gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.button}
              >
                {isSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.buttonText}>Continue</Text>
                    <Ionicons name="arrow-forward" size={18} color="#fff" />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <Text style={styles.footerText}>
            You can change your username later in settings
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    ...glow(colors.brand2, 0.6),
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 28,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  inputContainerError: {
    borderColor: colors.rose,
    backgroundColor: colors.roseFill,
  },
  atSymbol: {
    fontSize: 18,
    color: colors.textFaint,
    marginRight: 4,
    fontWeight: '500',
  },
  input: {
    flex: 1,
    fontSize: 18,
    color: colors.text,
    fontWeight: '500',
  },
  checkIcon: {
    marginLeft: 8,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  errorText: {
    color: colors.rose,
    fontSize: 13,
    fontWeight: '500',
  },
  hint: {
    fontSize: 13,
    color: colors.textFaint,
    marginBottom: 24,
  },
  button: {
    height: 56,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    ...glow(colors.brand2, 0.5),
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footerText: {
    fontSize: 13,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: 24,
  },
});
