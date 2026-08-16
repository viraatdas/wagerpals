// Join Group screen — small screen, but every failure mode matters: a typo'd
// code, a group the user is already in, and a request that's already
// pending are three different situations and get three different messages.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  AccessibilityInfo,
  findNodeHandle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { ApiError, toApiError } from '../utils/errors';
import { success, error as hapticError } from '../utils/haptics';
import { colors, radius, spacing, tokens, inputStyle } from '../theme';
import { Button, ErrorState } from '../components';

type JoinFailureKind = 'not_found' | 'already_member' | 'already_pending' | 'generic';

// app/api/groups/join/route.ts returns these exact `error` strings — matched
// here (rather than only falling back to ApiError.userMessage) so each
// realistic failure gets its own copy and, where useful, its own action.
function classifyJoinError(err: ApiError): JoinFailureKind {
  if (err.status === 404) return 'not_found';
  if (err.status === 400) {
    const msg = err.message.toLowerCase();
    if (msg.includes('already a member')) return 'already_member';
    if (msg.includes('already pending')) return 'already_pending';
  }
  return 'generic';
}

export default function JoinGroupScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { user } = useAuth();

  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [joinError, setJoinError] = useState<ApiError | null>(null);
  const [prefilledFromDeepLink, setPrefilledFromDeepLink] = useState(false);

  const lastFailedCodeRef = useRef<string | null>(null);
  const submitWrapperRef = useRef<View>(null);

  // A deep-linked groupId (wagerpals://groups/join/123456) prefills the
  // code. route.params doesn't change again for this screen's lifetime, so
  // this only needs to run once on mount.
  useEffect(() => {
    const params = route.params as { groupId?: string } | undefined;
    if (params?.groupId) {
      const digitsOnly = params.groupId.replace(/\D/g, '').slice(0, 6);
      if (digitsOnly) {
        setCode(digitsOnly);
        setPrefilledFromDeepLink(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the code arrived prefilled there's nothing to type, so move
  // accessibility focus to the submit action instead of the (already
  // complete) text field — the deep link should land the user ready to
  // confirm, not staring at a keyboard for a field they don't need to touch.
  useEffect(() => {
    if (!prefilledFromDeepLink) return;
    const timer = setTimeout(() => {
      const node = findNodeHandle(submitWrapperRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 400);
    return () => clearTimeout(timer);
  }, [prefilledFromDeepLink]);

  const runJoin = useCallback(
    async (codeOverride?: string) => {
      const codeToUse = codeOverride ?? code;
      if (!user || codeToUse.length !== 6 || isSubmitting) return;

      setIsSubmitting(true);
      setJoinError(null);
      try {
        await apiService.joinGroup(codeToUse, user.id);
        success();
        Alert.alert(
          'Request submitted',
          "You're on the list! We'll notify you as soon as an admin approves your request.",
          [{ text: 'OK', onPress: () => navigation.navigate('Main' as never) }]
        );
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups/join');
        hapticError();
        lastFailedCodeRef.current = codeToUse;
        setJoinError(apiErr);
      } finally {
        setIsSubmitting(false);
      }
    },
    [code, isSubmitting, user, navigation]
  );

  const handleJoin = useCallback(() => {
    void runJoin();
  }, [runJoin]);

  const handleChangeCode = useCallback(
    (text: string) => {
      const cleaned = text.replace(/\D/g, '').slice(0, 6);
      setCode(cleaned);
      if (joinError) setJoinError(null);
      // Auto-submit is a convenience once all 6 digits are in — but never
      // auto-retry the exact code that just failed (typing the same wrong
      // code back in would otherwise loop a request against the server).
      if (cleaned.length === 6 && cleaned !== lastFailedCodeRef.current) {
        void runJoin(cleaned);
      }
    },
    [joinError, runJoin]
  );

  const handleGoToGroup = useCallback(() => {
    navigation.navigate('GroupDetail' as never, { groupId: code } as never);
  }, [navigation, code]);

  const errorPresentation = useMemo(() => {
    if (!joinError) return null;
    const kind = classifyJoinError(joinError);
    switch (kind) {
      case 'not_found':
        return {
          title: 'Group not found',
          message: 'No group matches that code. Double-check it with whoever invited you.',
          actionLabel: 'Try Again',
          onAction: handleJoin,
        };
      case 'already_member':
        return {
          title: "You're already in",
          message: joinError.userMessage,
          actionLabel: 'Go to Group',
          onAction: handleGoToGroup,
        };
      case 'already_pending':
        return {
          title: 'Request already pending',
          message: joinError.userMessage,
          actionLabel: undefined,
          onAction: undefined,
        };
      default:
        return {
          title: 'Could not join group',
          message: joinError.userMessage,
          actionLabel: 'Try Again',
          onAction: handleJoin,
        };
    }
  }, [joinError, handleJoin, handleGoToGroup]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.title}>Join a Group</Text>
          <Text style={styles.subtitle}>Enter the 6-digit code shared by the group admin</Text>

          <TextInput
            style={[styles.input, !!errorPresentation && styles.inputError]}
            placeholder="000000"
            placeholderTextColor={colors.textFaint}
            value={code}
            onChangeText={handleChangeCode}
            maxLength={6}
            keyboardType="number-pad"
            autoCapitalize="characters"
            autoFocus={!prefilledFromDeepLink}
            editable={!isSubmitting}
            accessibilityLabel="6-digit group code"
          />

          {errorPresentation ? (
            <ErrorState
              compact
              title={errorPresentation.title}
              message={errorPresentation.message}
              onRetry={errorPresentation.onAction}
              retryLabel={errorPresentation.actionLabel}
              style={styles.errorBlock}
            />
          ) : null}

          <View ref={submitWrapperRef} accessible accessibilityRole="button" accessibilityLabel="Join Group" collapsable={false}>
            <Button
              title="Join Group"
              onPress={handleJoin}
              loading={isSubmitting}
              disabled={isSubmitting || code.length !== 6}
              fullWidth
              size="lg"
            />
          </View>

          <Text style={styles.note}>Your request will be pending until an admin approves it.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: spacing.xl,
    justifyContent: 'center',
  },
  title: {
    fontSize: tokens.fontSize['3xl'],
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: tokens.fontSize.base,
    color: colors.textMuted,
    marginBottom: spacing.xxl,
  },
  input: {
    ...inputStyle,
    height: 60,
    fontSize: tokens.fontSize['2xl'],
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: spacing.lg,
    fontVariant: ['tabular-nums'],
  },
  inputError: {
    borderColor: colors.rose,
  },
  errorBlock: {
    marginBottom: spacing.lg,
    backgroundColor: colors.bg2,
    borderRadius: radius.lg,
  },
  note: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: spacing.lg,
  },
});
