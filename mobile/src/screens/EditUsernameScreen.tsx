// Edit username screen
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { validateUsername } from '../utils/helpers';
import { ApiError, toApiError } from '../utils/errors';
import * as haptics from '../utils/haptics';
import { Button, Field, FormScreen, LoadingState } from '../components';
import { colors, font, spacing, tokens } from '../theme';

// The confirmation lingers just long enough to read before navigating back —
// same verb chain as UsernameSetupScreen: "Save" -> "Saving…" -> "Username
// saved."
const CONFIRMATION_LINGER_MS = 550;

export default function EditUsernameScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [username, setUsername] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    loadCurrentUsername();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadCurrentUsername = async () => {
    if (!user) return;
    setIsLoading(true);
    setLoadError('');
    try {
      const userData = await apiService.getUser(user.id);
      if (userData) {
        setCurrentUsername(userData.username);
        setUsername(userData.username);
      }
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/users');
      setLoadError(apiErr.userMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangeText = (text: string) => {
    setUsername(text);
    if (error) setError('');
  };

  const trimmed = username.trim();
  const isUnchanged = trimmed === currentUsername;
  const validation = validateUsername(trimmed);
  const liveError = trimmed.length > 0 && !isUnchanged && !validation.valid ? validation.error || 'Invalid username' : '';
  const displayError = error || liveError;
  const canSave = !isSaving && !isSaved && !isLoading && trimmed.length > 0 && !isUnchanged && validation.valid;

  const handleSubmit = async () => {
    if (isUnchanged) {
      navigation.goBack();
      return;
    }

    if (!validation.valid) {
      setError(validation.error || 'Invalid username');
      return;
    }

    if (!user) return;

    setIsSaving(true);
    setError('');

    try {
      // Deliberate username choice — apiService.setUsername() sends
      // `username_selected: true` (audit finding A10). RootNavigator gates
      // the UsernameSetup screen on that flag, so this must never be a bare
      // syncUser() call or a returning user could get trapped in the setup
      // loop.
      await apiService.setUsername(trimmed);
      haptics.success();
      if (!mountedRef.current) return;
      setIsSaved(true);
      setTimeout(() => {
        if (mountedRef.current) navigation.goBack();
      }, CONFIRMATION_LINGER_MS);
      return;
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/users');
      if (apiErr.status === 400 && /taken/i.test(apiErr.userMessage)) {
        setError('That username is taken. Try another one.');
      } else if (apiErr.status !== null && apiErr.status >= 500) {
        // Audit finding A6: username uniqueness is a TOCTOU race that can
        // surface as a raw 500 under concurrent requests for the same name.
        // Don't show the raw error — a generic "try again" is honest and
        // actionable without implying the app is broken.
        setError("That username didn't save. Try again.");
      } else {
        setError(apiErr.userMessage);
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingState label="Loading your username…" />
      </View>
    );
  }

  return (
    <FormScreen
      footer={
        <Button
          title={isSaved ? 'Saved' : isSaving ? 'Saving…' : 'Save'}
          onPress={handleSubmit}
          loading={isSaving}
          disabled={!canSave}
          fullWidth
          haptic="none"
        />
      }
    >
      {loadError ? (
        <Text style={styles.loadErrorText}>{loadError}</Text>
      ) : null}
      <Field
        label="Username"
        value={username}
        onChangeText={handleChangeText}
        placeholder="username"
        error={displayError}
        hint={displayError ? undefined : '2-20 characters • Letters, numbers, and underscores only'}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={20}
        showCount
        returnKeyType="done"
        onSubmitEditing={canSave ? handleSubmit : undefined}
        editable={!isSaving && !isSaved}
      />
      {isSaved ? (
        <View style={styles.savedRow}>
          <Ionicons name="checkmark-circle" size={16} color={tokens.color.win} />
          <Text style={styles.savedText}>Username saved.</Text>
        </View>
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  loadErrorText: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.rose,
    marginBottom: spacing.md,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  savedText: {
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.win,
  },
});
