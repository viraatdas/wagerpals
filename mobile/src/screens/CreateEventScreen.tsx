import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing, tokens } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { GroupMember, PaymentType } from '../types';
import { ApiError, toApiError } from '../utils/errors';
import { tapMedium, success, error as hapticError } from '../utils/haptics';
import {
  FormScreen,
  Field,
  AmountInput,
  SegmentedControl,
  Toggle,
  UserPicker,
  Button,
  LoadingState,
  ErrorState,
  type SegmentedOption,
} from '../components';
import type { UserPickerUser } from '../components/UserPicker';
import { MentionSuggestions } from '../components/MentionSuggestions';
import { useMentionAutocomplete } from '../utils/useMentionAutocomplete';
import type { MentionMember } from '../utils/mentions';

type CreateEventRouteProps = RouteProp<RootStackParamList, 'CreateEvent'>;

// Mirrors lib/payments.ts MAX_TRANSACTION_AMOUNT — kept in sync by hand since
// this mobile bundle can't import from the Next.js server package.
const MAX_STAKE_AMOUNT = 500;
const MAX_TITLE_LENGTH = 100;
const MAX_SIDE_LENGTH = 40;

const PAYMENT_OPTIONS: SegmentedOption<PaymentType>[] = [
  { value: 'none', label: 'Free' },
  { value: 'cash', label: 'Cash', icon: 'cash-outline', tone: 'brand' },
];

interface FormErrors {
  title?: string;
  sideA?: string;
  sideB?: string;
  stake?: string;
}

function validateForm(input: {
  title: string;
  sideA: string;
  sideB: string;
  paymentType: PaymentType;
  stakeAmount: string;
}): FormErrors {
  const errors: FormErrors = {};
  const trimmedTitle = input.title.trim();
  const trimmedA = input.sideA.trim();
  const trimmedB = input.sideB.trim();

  if (!trimmedTitle) {
    errors.title = 'Give the wager a title.';
  } else if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    errors.title = `Keep it under ${MAX_TITLE_LENGTH} characters.`;
  }

  if (!trimmedA) {
    errors.sideA = 'Name side A.';
  } else if (trimmedA.length > MAX_SIDE_LENGTH) {
    errors.sideA = `Keep it under ${MAX_SIDE_LENGTH} characters.`;
  }

  if (!trimmedB) {
    errors.sideB = 'Name side B.';
  } else if (trimmedB.length > MAX_SIDE_LENGTH) {
    errors.sideB = `Keep it under ${MAX_SIDE_LENGTH} characters.`;
  }

  if (!errors.sideA && !errors.sideB && trimmedA.toLowerCase() === trimmedB.toLowerCase()) {
    errors.sideB = 'Side B must be different from side A.';
  }

  if (input.paymentType === 'cash') {
    const stake = parseFloat(input.stakeAmount);
    if (!input.stakeAmount || !Number.isFinite(stake) || stake <= 0) {
      errors.stake = 'Enter a stake amount.';
    } else if (stake > MAX_STAKE_AMOUNT) {
      errors.stake = `Max stake is $${MAX_STAKE_AMOUNT}.`;
    }
  }

  return errors;
}

// Turns a create-event failure into copy a user can act on. Falls back to
// the server's own message (via ApiError.userMessage) for anything we don't
// have a more specific story for.
function describeCreateEventError(err: ApiError): string {
  // A cash-disabled-for-this-group rejection can also come back as a 403 —
  // don't let the generic membership copy below swallow it. Fall through to
  // the server's own (product-voice) message verbatim in that case.
  if (err.status === 403 && !/cash/i.test(err.message)) {
    return "You're not an active member of this group, so you can't create events here.";
  }
  if (err.status === 400 && /subject/i.test(err.message)) {
    return 'The person you tagged is no longer an active member of this group. Remove the tag and try again.';
  }
  return err.userMessage;
}

export default function CreateEventScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<CreateEventRouteProps>();
  const { user } = useAuth();
  const { groupId } = route.params;

  const [title, setTitle] = useState('');
  const [sideA, setSideA] = useState('');
  const [sideB, setSideB] = useState('');
  const [paymentType, setPaymentType] = useState<PaymentType>('none');
  const [stakeAmount, setStakeAmount] = useState('');
  const [subjectUserId, setSubjectUserId] = useState<string | null>(null);
  const [notifySubject, setNotifySubject] = useState(true);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Audit finding D11 / A7: the creator's identity for the activity feed and
  // membership check must come from the backend user record, never the
  // device's OS display name. If this fails to load we refuse to submit
  // rather than silently falling back to something else.
  const [creatorUsername, setCreatorUsername] = useState<string | null>(null);
  const [creatorUsernameError, setCreatorUsernameError] = useState<string | null>(null);
  const [loadingCreator, setLoadingCreator] = useState(true);
  const [creatorReloadKey, setCreatorReloadKey] = useState(0);

  useEffect(() => {
    if (!user) {
      setLoadingCreator(false);
      return;
    }
    let cancelled = false;
    setLoadingCreator(true);
    setCreatorUsernameError(null);
    apiService
      .getUser(user.id)
      .then((u) => {
        if (cancelled) return;
        setCreatorUsername(u.username);
        setLoadingCreator(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/users');
        setCreatorUsernameError(apiErr.userMessage);
        setLoadingCreator(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, creatorReloadKey]);

  // Subject-tagging candidates: active members of this group, minus the
  // creator themselves. Its own loading/error state so a slow or failing
  // members fetch never blocks the rest of the form.
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersReloadKey, setMembersReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setMembersLoading(true);
    setMembersError(null);
    apiService
      .getGroupMembers(groupId)
      .then((data) => {
        if (cancelled) return;
        setMembers(data);
        setMembersLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups/members');
        setMembersError(apiErr.userMessage);
        setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, membersReloadKey]);

  const subjectCandidates: UserPickerUser[] = useMemo(
    () =>
      members
        .filter((m) => m.status === 'active' && m.user_id !== user?.id)
        .map((m) => ({ id: m.user_id, username: m.username || 'Member' })),
    [members, user?.id]
  );

  const subjectUsername = subjectCandidates.find((u) => u.id === subjectUserId)?.username;

  // @mention candidates for the title field — same active-members-minus-self
  // set as the subject picker above, just kept in MentionMember shape.
  const mentionMembers: MentionMember[] = useMemo(
    () =>
      members
        .filter((m) => m.status === 'active' && m.user_id !== user?.id)
        .map((m) => ({ user_id: m.user_id, username: m.username || 'Member', role: m.role })),
    [members, user?.id]
  );

  const titleMention = useMentionAutocomplete({ members: mentionMembers, value: title, onChange: setTitle });

  // Group-level cash enablement — POST /api/events rejects payment_type:
  // 'cash' for a group where it's false. A missing value (older cached
  // payload) is treated as disabled, never as enabled.
  const [cashEnabled, setCashEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiService
      .getGroup(groupId)
      .then((g) => {
        if (cancelled) return;
        setCashEnabled(g?.cash_enabled ?? false);
      })
      .catch(() => {
        // Non-fatal: the cash option just stays hidden, same as a group
        // with cash disabled.
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const handleCreate = async () => {
    if (!user) {
      setSubmitError('You must be signed in to create an event.');
      return;
    }

    const errors = validateForm({ title, sideA, sideB, paymentType, stakeAmount });
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    if (!creatorUsername) {
      setSubmitError(
        creatorUsernameError
          ? 'Could not load your profile. Fix that above before creating an event.'
          : 'Still loading your profile. Try again in a moment.'
      );
      return;
    }

    tapMedium();
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const newEvent = await apiService.createEvent({
        title: title.trim(),
        side_a: sideA.trim(),
        side_b: sideB.trim(),
        // No-expiry rules: end_time is meaningless server-side now — don't
        // send one.
        group_id: groupId,
        creator_user_id: user.id,
        creator_username: creatorUsername,
        payment_type: paymentType,
        stake_amount: paymentType === 'cash' ? parseFloat(stakeAmount) : undefined,
        subject_user_id: subjectUserId ?? undefined,
        notify_subject: subjectUserId ? notifySubject : undefined,
      });

      success();
      navigation.navigate('EventDetail' as never, { eventId: newEvent.id } as never);
    } catch (err) {
      hapticError();
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/events');
      setSubmitError(describeCreateEventError(apiErr));
    } finally {
      setIsSubmitting(false);
    }
  };

  // If cash gets disabled out from under a selection somehow (e.g. the
  // group's cash_enabled flips while this screen is open), fall back to the
  // free/points path instead of submitting a request the server will reject.
  useEffect(() => {
    if (!cashEnabled && paymentType === 'cash') {
      setPaymentType('none');
      setStakeAmount('');
    }
  }, [cashEnabled, paymentType]);

  const canSubmit = !isSubmitting && !loadingCreator;

  return (
    <View style={styles.container}>
      <FormScreen
        footer={
          <>
            {submitError ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color={colors.rose} />
                <Text style={styles.errorBannerText}>{submitError}</Text>
              </View>
            ) : null}
            <Button
              title="Create Wager"
              onPress={handleCreate}
              icon="add-circle-outline"
              loading={isSubmitting}
              disabled={!canSubmit}
              fullWidth
              haptic="none"
            />
          </>
        }
      >
        <Text style={styles.heading}>Create a Wager</Text>
        <Text style={styles.subheading}>Set the terms and put it out there</Text>

        {creatorUsernameError ? (
          <ErrorState
            compact
            title="Couldn't load your profile"
            message={creatorUsernameError}
            onRetry={() => setCreatorReloadKey((k) => k + 1)}
          />
        ) : null}

        <Field
          label="Wager Title"
          value={title}
          onChangeText={(t) => {
            setTitle(t);
            if (formErrors.title) setFormErrors((prev) => ({ ...prev, title: undefined }));
          }}
          onSelectionChange={titleMention.onSelectionChange}
          inputRef={titleMention.inputRef}
          placeholder="Will it rain tomorrow?"
          error={formErrors.title}
          maxLength={MAX_TITLE_LENGTH}
          showCount
          returnKeyType="next"
        />
        {titleMention.isOpen ? (
          <MentionSuggestions candidates={titleMention.candidates} onPick={titleMention.acceptMention} />
        ) : null}

        {/* Side A/B are visually pre-bound to Emerald/Crimson from the start
            — the same convention the bet form, side cards and confidence
            bar use everywhere else once the wager exists. */}
        <View style={styles.sideLabelRow}>
          <View style={[styles.sideDot, { backgroundColor: tokens.color.emerald }]} />
          <Text style={styles.sideLabelText}>Side A</Text>
        </View>
        <Field
          value={sideA}
          onChangeText={(t) => {
            setSideA(t);
            if (formErrors.sideA || formErrors.sideB) {
              setFormErrors((prev) => ({ ...prev, sideA: undefined, sideB: undefined }));
            }
          }}
          placeholder="e.g. Yes"
          error={formErrors.sideA}
          maxLength={MAX_SIDE_LENGTH}
          returnKeyType="next"
        />

        <View style={styles.sideLabelRow}>
          <View style={[styles.sideDot, { backgroundColor: tokens.color.crimson }]} />
          <Text style={styles.sideLabelText}>Side B</Text>
        </View>
        <Field
          value={sideB}
          onChangeText={(t) => {
            setSideB(t);
            if (formErrors.sideA || formErrors.sideB) {
              setFormErrors((prev) => ({ ...prev, sideA: undefined, sideB: undefined }));
            }
          }}
          placeholder="e.g. No"
          error={formErrors.sideB}
          maxLength={MAX_SIDE_LENGTH}
          returnKeyType="done"
        />

        {cashEnabled ? (
          <>
            <Text style={styles.sectionLabel}>Payment</Text>
            <SegmentedControl options={PAYMENT_OPTIONS} value={paymentType} onChange={setPaymentType} />
            {paymentType === 'cash' ? (
              <View style={styles.stakeWrap}>
                <AmountInput
                  label="Stake Amount"
                  value={stakeAmount}
                  onChangeText={(v) => {
                    setStakeAmount(v);
                    if (formErrors.stake) setFormErrors((prev) => ({ ...prev, stake: undefined }));
                  }}
                  max={MAX_STAKE_AMOUNT}
                  error={formErrors.stake}
                />
                <View style={styles.infoRow}>
                  <Ionicons name="lock-closed-outline" size={14} color={colors.textFaint} />
                  <Text style={styles.infoText}>
                    Each participant's stake is escrowed from their wallet until the event resolves.
                  </Text>
                </View>
              </View>
            ) : null}
          </>
        ) : null}

        <View style={styles.subjectHeaderRow}>
          <Ionicons name="person-outline" size={14} color={colors.amber} />
          <Text style={styles.sectionLabel}>This bet is about someone (optional)</Text>
        </View>
        {membersLoading ? (
          <LoadingState compact label="Loading group members…" />
        ) : membersError ? (
          <ErrorState compact message={membersError} onRetry={() => setMembersReloadKey((k) => k + 1)} />
        ) : (
          <>
            <UserPicker
              users={subjectCandidates}
              value={subjectUserId}
              onChange={setSubjectUserId}
              placeholder="No one, general bet"
              hint="Pick who this wager is about."
            />
            {subjectUserId ? (
              <Toggle
                label="Keep it secret from them"
                value={!notifySubject}
                onValueChange={(secret) => setNotifySubject(!secret)}
                description={
                  notifySubject
                    ? `${subjectUsername ?? 'They'} will be notified about this bet.`
                    : `Quiet bet: ${subjectUsername ?? 'they'} won't be notified.`
                }
              />
            ) : null}
          </>
        )}
      </FormScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  heading: {
    fontSize: tokens.fontSize['2xl'],
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subheading: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },
  sectionLabel: {
    fontSize: tokens.fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  subjectHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sideLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  sideDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sideLabelText: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
  },
  stakeWrap: {
    marginTop: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: -spacing.sm,
    marginBottom: spacing.lg,
  },
  infoText: {
    flex: 1,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
    lineHeight: tokens.lineHeight.xs,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  errorBannerText: {
    flex: 1,
    fontSize: tokens.fontSize.xs,
    color: colors.rose,
  },
});
