// Edit username screen
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { validateUsername } from '../utils/helpers';
import { colors, gradients, radius, glow, inputStyle } from '../theme';

export default function EditUsernameScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [username, setUsername] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadCurrentUsername();
  }, [user]);

  const loadCurrentUsername = async () => {
    if (!user) return;

    try {
      const userData = await apiService.getUser(user.id);
      if (userData) {
        setCurrentUsername(userData.username);
        setUsername(userData.username);
      }
    } catch (error) {
      console.error('Failed to load username:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (username === currentUsername) {
      navigation.goBack();
      return;
    }

    const validation = validateUsername(username);
    if (!validation.valid) {
      setError(validation.error || 'Invalid username');
      return;
    }

    if (!user) return;

    setIsSaving(true);
    setError('');

    try {
      await apiService.createOrUpdateUser(user.id, username);
      Alert.alert('Success', 'Username updated successfully');
      navigation.goBack();
    } catch (error: any) {
      setError(error.message || 'Failed to update username');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.brand2} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <View style={styles.form}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={[styles.input, error ? styles.inputError : null]}
            placeholder="Username"
            placeholderTextColor={colors.textFaint}
            value={username}
            onChangeText={(text) => {
              setUsername(text);
              setError('');
            }}
            autoCapitalize="none"
            autoFocus
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Text style={styles.hint}>
            3-20 characters • Letters, numbers, dashes, and underscores only
          </Text>

          <TouchableOpacity
            onPress={handleSubmit}
            disabled={isSaving || !username}
            style={(isSaving || !username) && styles.buttonDisabled}
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
                <Text style={styles.buttonText}>Save Changes</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  form: {
    width: '100%',
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
    color: colors.textMuted,
  },
  input: {
    ...inputStyle,
    height: 52,
    fontSize: 18,
    marginBottom: 8,
  },
  inputError: {
    borderColor: colors.rose,
  },
  errorText: {
    color: colors.rose,
    fontSize: 14,
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    color: colors.textFaint,
    marginBottom: 24,
  },
  button: {
    height: 52,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    ...glow(colors.brand2, 0.5),
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
});





