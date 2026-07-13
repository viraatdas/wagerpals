// Authentication screen - Modern iOS design
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
  Alert,
  StatusBar,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import authService from '../services/auth';
import { colors, gradients, radius, glow, inputStyle } from '../theme';

const { width } = Dimensions.get('window');

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<'email' | 'code'>('email');

  const handleSendCode = async () => {
    if (!email || !email.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    try {
      await authService.sendMagicLink(email);
      setStep('code');
      Alert.alert(
        'Check Your Email',
        'We sent you a 6-digit verification code. Enter it below to sign in.',
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to send code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code || code.length < 6) {
      Alert.alert('Invalid Code', 'Please enter the 6-digit verification code');
      return;
    }

    setIsLoading(true);
    try {
      await authService.signInWithCode(email, code);
      // Auth state change will trigger navigation via RootNavigator
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Invalid code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setIsLoading(true);
    try {
      await authService.signInWithGoogle();
      // Auth state change will trigger navigation via RootNavigator
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Google sign in failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToEmail = () => {
    setStep('email');
    setCode('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          {/* Logo & Header */}
          <View style={styles.header}>
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoContainer}
            >
              <Ionicons name="trophy" size={40} color="#fff" />
            </LinearGradient>
            <Text style={styles.title}>
              <Text style={styles.titleWager}>Wager</Text>
              <Text style={styles.titlePals}>Pals</Text>
            </Text>
            <Text style={styles.subtitle}>Polymarket for friends</Text>
          </View>

          {/* Auth Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {step === 'email' ? 'Welcome' : 'Verify Email'}
            </Text>
            <Text style={styles.cardSubtitle}>
              {step === 'email' 
                ? 'Sign in to start betting with friends'
                : `Enter the code sent to ${email}`
              }
            </Text>

            {step === 'email' ? (
              <View style={styles.form}>
                <View style={styles.inputContainer}>
                  <Ionicons name="mail-outline" size={20} color={colors.textFaint} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your email"
                    placeholderTextColor={colors.textFaint}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    editable={!isLoading}
                  />
                </View>

                <TouchableOpacity
                  onPress={handleSendCode}
                  disabled={isLoading || !email}
                  activeOpacity={0.8}
                  style={(!email || isLoading) && styles.buttonDisabled}
                >
                  <LinearGradient
                    colors={gradients.brand}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.button, styles.primaryButton]}
                  >
                    {isLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Text style={styles.primaryButtonText}>Continue with Email</Text>
                        <Ionicons name="arrow-forward" size={18} color="#fff" />
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>

                <TouchableOpacity
                  style={[styles.button, styles.googleButton]}
                  onPress={handleGoogleAuth}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  <View style={styles.googleIconContainer}>
                    <Text style={styles.googleIcon}>G</Text>
                  </View>
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.form}>
                <View style={styles.codeContainer}>
                  <TextInput
                    style={styles.codeInput}
                    placeholder="000000"
                    placeholderTextColor={colors.textFaint}
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    maxLength={6}
                    editable={!isLoading}
                    autoFocus
                  />
                </View>

                <TouchableOpacity
                  onPress={handleVerifyCode}
                  disabled={isLoading || code.length < 6}
                  activeOpacity={0.8}
                  style={(code.length < 6 || isLoading) && styles.buttonDisabled}
                >
                  <LinearGradient
                    colors={gradients.brand}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.button, styles.primaryButton]}
                  >
                    {isLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Text style={styles.primaryButtonText}>Verify & Sign In</Text>
                        <Ionicons name="checkmark" size={18} color="#fff" />
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                <View style={styles.codeActions}>
                  <TouchableOpacity
                    style={styles.linkButton}
                    onPress={handleBackToEmail}
                    disabled={isLoading}
                  >
                    <Ionicons name="arrow-back" size={16} color={colors.brand2} />
                    <Text style={styles.linkButtonText}>Use different email</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.linkButton}
                    onPress={handleSendCode}
                    disabled={isLoading}
                  >
                    <Ionicons name="refresh" size={16} color={colors.brand2} />
                    <Text style={styles.linkButtonText}>Resend code</Text>
                  </TouchableOpacity>
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
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    ...glow(colors.brand2, 0.6),
  },
  title: {
    fontSize: 36,
    marginBottom: 8,
  },
  titleWager: {
    fontWeight: '300',
    color: colors.text,
  },
  titlePals: {
    fontWeight: '700',
    color: colors.brand2,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: '400',
  },
  card: {
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 28,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  cardSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 20,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  codeContainer: {
    marginBottom: 20,
  },
  codeInput: {
    height: 64,
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 32,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    letterSpacing: 12,
  },
  button: {
    height: 56,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  primaryButton: {
    ...glow(colors.brand2, 0.5),
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    marginHorizontal: 16,
    color: colors.textFaint,
    fontSize: 14,
    fontWeight: '500',
  },
  googleButton: {
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1,
    borderColor: colors.border,
  },
  googleIconContainer: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleIcon: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ea4335',
  },
  googleButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  codeActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  linkButtonText: {
    color: colors.brand2,
    fontSize: 14,
    fontWeight: '500',
  },
  termsText: {
    fontSize: 12,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
    paddingHorizontal: 20,
  },
  termsLink: {
    color: colors.brand2,
    fontWeight: '500',
  },
});
