// Username setup screen — the first real screen a brand-new user sees after
// signing in, so it needs to feel confident and explain *why* a username is
// needed (not just demand one): it's how friends find you and how bets get
// attributed to you on the ledger.
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { validateUsername } from '../utils/helpers';
import { ApiError, toApiError } from '../utils/errors';
import * as haptics from '../utils/haptics';
import { Button, Field, FormScreen } from '../components';
import { colors, font, gradients, radius, spacing, tokens } from '../theme';

interface UsernameSetupScreenProps {
  onUsernameSet?: () => void;
}

// Same verb chain as EditUsernameScreen: "Save" -> "Saving…" -> "Username
// saved." — the confirmation lingers briefly before handing off to the rest
// of onboarding.
const CONFIRMATION_LINGER_MS = 550;

export default function UsernameSetupScreen({ onUsernameSet }: UsernameSetupScreenProps) {
  const { user } = useAuth();
  const [username, setUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const trimmed = username.trim();
  const validation = validateUsername(trimmed);
  const liveError = trimmed.length > 0 && !validation.valid ? validation.error || 'Invalid username' : '';
  const displayError = error || liveError;
  const canSave = !isSaving && !isSaved && trimmed.length > 0 && validation.valid;

  const handleChangeText = (text: string) => {
    // Usernames are lowercase alphanumeric+underscore only — strip anything
    // else as the user types so they never hit a validation error for a
    // character we're about to reject anyway.
    setUsername(text.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    if (error) setError('');
  };

  const handleSubmit = async () => {
    if (!validation.valid) {
      setError(validation.error || 'Invalid username');
      return;
    }

    if (!user) return;

    setIsSaving(true);
    setError('');

    try {
      // Deliberate username choice — apiService.setUsername() sends
      // `username_selected: true` (audit finding A10: mobile used to call a
      // bare syncUser(), which left this flag false and trapped returning
      // users back in this screen since RootNavigator gates on it).
      await apiService.setUsername(trimmed);
      haptics.success();
      if (!mountedRef.current) return;
      setIsSaved(true);
      setTimeout(() => {
        if (mountedRef.current) onUsernameSet?.();
      }, CONFIRMATION_LINGER_MS);
      return;
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/users');
      if (apiErr.status === 400 && /taken/i.test(apiErr.userMessage)) {
        setError('That username is taken. Try another one.');
      } else if (apiErr.status !== null && apiErr.status >= 500) {
        // Audit finding A6: username uniqueness is a TOCTOU race that can
        // surface as a raw 500 under concurrent requests for the same name.
        setError("That username didn't save. Try again.");
      } else {
        setError(apiErr.userMessage);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <FormScreen
        keyboardOffset={0}
        footer={
          <Button
            title={isSaved ? 'Saved' : isSaving ? 'Saving…' : 'Save'}
            onPress={handleSubmit}
            loading={isSaving}
            disabled={!canSave}
            icon={isSaved ? 'checkmark' : 'arrow-forward'}
            iconPosition="right"
            fullWidth
            haptic="none"
          />
        }
      >
        <View style={styles.header}>
          <LinearGradient
            colors={gradients.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconContainer}
          >
            <Ionicons name="person-add" size={36} color={colors.white} />
          </LinearGradient>
          <Text style={styles.title}>Welcome to WagerPals</Text>
          <Text style={styles.subtitle}>
            Pick a username. It's how friends find you and how your bets show up on the ledger.
          </Text>
        </View>

        <Field
          label="Username"
          value={username}
          onChangeText={handleChangeText}
          placeholder="your_username"
          leadingIcon="at"
          error={displayError}
          hint={displayError ? undefined : '2-20 characters • Letters, numbers, underscores'}
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

        <Text style={styles.footerText}>You can change your username later in settings.</Text>
      </FormScreen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
    ...tokens.shadow.accent,
  },
  title: {
    fontFamily: font.display,
    fontSize: tokens.fontSize.xl,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.base,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: tokens.lineHeight.base,
    paddingHorizontal: spacing.md,
  },
  footerText: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: spacing.sm,
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
