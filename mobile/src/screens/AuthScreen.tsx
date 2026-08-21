// Authentication screen - Modern iOS design
//
// n2 parity (docs/IDENTITY.md): email sign-up and Google sign-in for the same
// verified email resolve to ONE WagerPals account (lib/sync-user.ts, backed
// by Stack Auth's `link_method` OAuth merge strategy). The copy below is
// written so it never implies "sign in" and "create an account" are two
// different destinations for the same person — there's one welcome screen,
// one set of buttons, and a line that says outright that email and Google
// land on the same account.
import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as AppleAuthentication from 'expo-apple-authentication';
import authService from '../services/auth';
import { ApiError, toApiError } from '../utils/errors';
import * as haptics from '../utils/haptics';
import { Button, FormScreen } from '../components';
import { colors, font, gradients, radius, spacing, tokens } from '../theme';

type Step = 'email' | 'code';
type Busy = null | 'sendCode' | 'verify' | 'google' | 'apple' | 'resend';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

function isValidEmail(value: string): boolean {
  // Deliberately loose — the server is the real validator. This just keeps
  // an obviously-incomplete address from firing a request.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function classifyError(err: unknown, endpoint: string): ApiError {
  return err instanceof ApiError ? err : toApiError(err, endpoint);
}

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('email');
  const [busy, setBusy] = useState<Busy>(null);
  const [emailError, setEmailError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const codeInputRef = useRef<TextInput>(null);

  useEffect(() => {
    // Sign in with Apple is iOS-only and only on supported OS versions. Gate
    // the button on a real availability check so Android/unsupported never
    // renders it (App Review Guideline 4.8 only requires it where Google is
    // offered, which is every platform, but the native sheet is Apple-only).
    let cancelled = false;
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync()
        .then((available) => {
          if (!cancelled) setAppleAvailable(available);
        })
        .catch(() => {
          if (!cancelled) setAppleAvailable(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleSendCode = async (isResend = false) => {
    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setEmailError('Enter a valid email address');
      return;
    }
    if (busy) return;

    setBusy(isResend ? 'resend' : 'sendCode');
    setEmailError('');
    if (isResend) setCodeError('');

    try {
      await authService.sendMagicLink(trimmedEmail);
      setStep('code');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      if (!isResend) {
        haptics.tapLight();
        setCode('');
      }
    } catch (err) {
      const apiErr = classifyError(err, '/api/auth/mobile-magic-link');
      const message = apiErr.isOffline
        ? "You're offline. Check your connection and try again."
        : apiErr.userMessage;
      if (isResend) {
        setCodeError(message);
      } else {
        setEmailError(message);
      }
    } finally {
      setBusy(null);
    }
  };

  const handleVerifyCode = async () => {
    if (code.length < CODE_LENGTH) {
      setCodeError(`Enter the ${CODE_LENGTH}-digit code`);
      return;
    }
    if (busy) return;

    setBusy('verify');
    setCodeError('');

    try {
      await authService.signInWithCode(email.trim(), code);
      haptics.success();
      // Auth state change will trigger navigation via RootNavigator
    } catch (err) {
      const apiErr = classifyError(err, '/api/auth/mobile-verify-code');
      if (apiErr.isOffline) {
        setCodeError("You're offline. Check your connection and try again.");
      } else if (/expired/i.test(apiErr.message)) {
        // The current server contract collapses "wrong" and "expired" into
        // one generic 401, but if a more specific message ever comes
        // through, prefer it.
        setCodeError('That code expired. Resend a new one and try again.');
      } else {
        setCodeError("That code isn't right. Double-check it or resend a new one.");
      }
      haptics.error();
    } finally {
      setBusy(null);
    }
  };

  // Native Google Sign-In only works when the iOS OAuth client id is baked
  // into the build (EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID). Until it is, hide the
  // Google button so no one taps a button that can't complete — Apple + email
  // still cover sign-in (and Apple satisfies Guideline 4.8 on its own).
  const googleConfigured = !!process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

  const handleGoogleAuth = async () => {
    if (busy) return;
    setBusy('google');
    setEmailError('');

    try {
      await authService.signInWithGoogle();
      haptics.success();
      // Auth state change will trigger navigation via RootNavigator
    } catch (err) {
      // A user backing out of the Google sheet is not an error worth
      // surfacing — authService throws this exact message for both an
      // explicit cancel and a dismissed browser sheet.
      if (err instanceof Error && err.message === 'Authentication cancelled') {
        return;
      }
      const apiErr = classifyError(err, '/api/auth/mobile-oauth');
      setEmailError(apiErr.isOffline ? "You're offline. Check your connection and try again." : apiErr.userMessage);
    } finally {
      setBusy(null);
    }
  };

  const handleAppleAuth = async () => {
    if (busy) return;
    setBusy('apple');
    setEmailError('');

    try {
      await authService.signInWithApple();
      haptics.success();
      // Auth state change will trigger navigation via RootNavigator
    } catch (err) {
      // Backing out of the Apple sheet is not an error worth surfacing —
      // authService throws this exact message on ERR_REQUEST_CANCELED.
      if (err instanceof Error && err.message === 'Authentication cancelled') {
        return;
      }
      const apiErr = classifyError(err, '/api/auth/apple-native');
      setEmailError(apiErr.isOffline ? "You're offline. Check your connection and try again." : apiErr.userMessage);
    } finally {
      setBusy(null);
    }
  };

  const handleBackToEmail = () => {
    setStep('email');
    setCode('');
    setCodeError('');
    setCooldown(0);
  };

  const handleCodeChange = (text: string) => {
    setCode(text.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH));
    if (codeError) setCodeError('');
  };

  const handleEmailChange = (text: string) => {
    setEmail(text);
    if (emailError) setEmailError('');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <FormScreen
        contentContainerStyle={styles.formContent}
        keyboardOffset={0}
      >
        {/* Logo & Header */}
        <View style={styles.header}>
          <LinearGradient
            colors={gradients.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logoContainer}
          >
            <Ionicons name="trophy" size={40} color={colors.white} />
          </LinearGradient>
          <Text style={styles.title}>
            <Text style={styles.titleWager}>Wager</Text>
            <Text style={styles.titlePals}>Pals</Text>
          </Text>
          <Text style={styles.subtitle}>Bet on anything with friends. Real stakes, real fun.</Text>
        </View>

        {/* Auth Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{step === 'email' ? 'Welcome' : 'Verify your email'}</Text>
          <Text style={styles.cardSubtitle}>
            {step === 'email'
              ? 'Sign in with email or Google. Same address, same WagerPals account, automatically.'
              : `Enter the code sent to ${email.trim()}`}
          </Text>

          {step === 'email' ? (
            <View style={styles.form}>
              <View style={[styles.inputContainer, emailError && styles.inputContainerError]}>
                <Ionicons name="mail-outline" size={20} color={colors.textFaint} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email"
                  placeholderTextColor={colors.textFaint}
                  value={email}
                  onChangeText={handleEmailChange}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="go"
                  onSubmitEditing={() => handleSendCode(false)}
                  editable={busy === null}
                />
              </View>
              {emailError ? (
                <View style={styles.errorRow}>
                  <Ionicons name="alert-circle" size={14} color={colors.rose} />
                  <Text style={styles.errorText}>{emailError}</Text>
                </View>
              ) : null}

              <Button
                title="Continue with Email"
                onPress={() => handleSendCode(false)}
                loading={busy === 'sendCode'}
                disabled={busy !== null && busy !== 'sendCode'}
                icon="arrow-forward"
                iconPosition="right"
                fullWidth
                haptic="none"
                style={styles.primaryAction}
              />

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              {googleConfigured ? (
                <Button
                  title="Continue with Google"
                  onPress={handleGoogleAuth}
                  loading={busy === 'google'}
                  disabled={busy !== null && busy !== 'google'}
                  variant="secondary"
                  icon="logo-google"
                  fullWidth
                  haptic="none"
                />
              ) : null}

              {appleAvailable ? (
                // Apple mandates their official button + styling. Black-on-paper
                // reads best against the light "paper" surface. Native sheet is
                // iOS-only, so this only renders after isAvailableAsync().
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={radius.md}
                  style={styles.appleButton}
                  onPress={handleAppleAuth}
                />
              ) : null}
            </View>
          ) : (
            <View style={styles.form}>
              <View style={styles.codeContainer}>
                <TextInput
                  ref={codeInputRef}
                  style={[styles.codeInput, codeError && styles.inputContainerError]}
                  placeholder={'0'.repeat(CODE_LENGTH)}
                  placeholderTextColor={colors.textFaint}
                  value={code}
                  onChangeText={handleCodeChange}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  maxLength={CODE_LENGTH}
                  editable={busy === null}
                  autoFocus
                  onSubmitEditing={handleVerifyCode}
                />
              </View>
              {codeError ? (
                <View style={styles.errorRow}>
                  <Ionicons name="alert-circle" size={14} color={colors.rose} />
                  <Text style={styles.errorText}>{codeError}</Text>
                </View>
              ) : null}

              <Button
                title="Verify & Sign In"
                onPress={handleVerifyCode}
                loading={busy === 'verify'}
                disabled={(busy !== null && busy !== 'verify') || code.length < CODE_LENGTH}
                icon="checkmark"
                iconPosition="right"
                fullWidth
                haptic="none"
                style={styles.primaryAction}
              />

              <View style={styles.codeActions}>
                <Button
                  title="Use different email"
                  onPress={handleBackToEmail}
                  disabled={busy !== null}
                  variant="ghost"
                  size="sm"
                  icon="arrow-back"
                  haptic="none"
                />
                <Button
                  title={cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
                  onPress={() => handleSendCode(true)}
                  loading={busy === 'resend'}
                  disabled={cooldown > 0 || (busy !== null && busy !== 'resend')}
                  variant="ghost"
                  size="sm"
                  icon="refresh"
                  haptic="none"
                />
              </View>
            </View>
          )}
        </View>

        {/* Terms */}
        <Text style={styles.termsText}>
          By signing in, you agree to our{' '}
          <Text style={styles.termsLink}>Terms of Service</Text>
          {' '}and{' '}
          <Text style={styles.termsLink}>Privacy Policy</Text>
        </Text>
      </FormScreen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  formContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
    ...tokens.shadow.accent,
  },
  title: {
    fontSize: tokens.fontSize['3xl'],
    marginBottom: spacing.sm,
  },
  titleWager: {
    fontFamily: font.display,
    color: colors.text,
  },
  titlePals: {
    fontFamily: font.display,
    color: colors.brand2,
  },
  subtitle: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.base,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...tokens.shadow.elev2,
  },
  cardTitle: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize['2xl'],
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  cardSubtitle: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: tokens.lineHeight.sm,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  inputContainerError: {
    borderColor: colors.rose,
  },
  inputIcon: {
    marginRight: spacing.md,
  },
  input: {
    flex: 1,
    fontFamily: font.sans,
    fontSize: tokens.fontSize.base,
    color: colors.text,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  // Keeps each field's action directly under it — a tight 12-unit gap — so
  // "Continue with Email" / "Verify & Sign In" read as part of the same
  // control as the field above, not detached at the bottom of the screen.
  primaryAction: {
    marginTop: spacing.md,
  },
  errorText: {
    flexShrink: 1,
    fontFamily: font.sans,
    fontSize: tokens.fontSize.xs,
    color: colors.rose,
  },
  codeContainer: {
    marginBottom: spacing.sm,
  },
  codeInput: {
    height: 64,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: font.monoMedium,
    fontSize: tokens.fontSize['3xl'],
    color: colors.text,
    textAlign: 'center',
    letterSpacing: 12,
  },
  // Height matches the Button component's default (md = 44) so the Apple
  // button lines up with "Continue with Google" directly above it.
  appleButton: {
    height: 44,
    width: '100%',
    marginTop: spacing.md,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    marginHorizontal: spacing.lg,
    color: colors.textFaint,
    fontFamily: font.sansMedium,
    fontSize: tokens.fontSize.sm,
  },
  codeActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  termsText: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: spacing.xl,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
  },
  termsLink: {
    fontFamily: font.sansMedium,
    color: colors.brand2,
  },
});
