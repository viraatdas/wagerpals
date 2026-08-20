import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing, tokens } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { GroupMember } from '../types';
import { ApiError, toApiError } from '../utils/errors';
import { tapMedium, success, error as hapticError } from '../utils/haptics';
import {
  FormScreen,
  Field,
  Button,
  ErrorState,
} from '../components';
import { MentionSuggestions } from '../components/MentionSuggestions';
import { MentionHidePanel } from '../components/MentionHidePanel';
import { useMentionAutocomplete } from '../utils/useMentionAutocomplete';
import { getMentionedMembers, type MentionMember } from '../utils/mentions';

type CreateEventRouteProps = RouteProp<RootStackParamList, 'CreateEvent'>;

const MAX_TITLE_LENGTH = 100;
const MAX_SIDE_LENGTH = 40;

interface FormErrors {
  title?: string;
  sideA?: string;
  sideB?: string;
}

function validateForm(input: {
  title: string;
  sideA: string;
  sideB: string;
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
  // Who this bet is hidden from, if anyone — always a member currently
  // @mentioned in the title (see mentionedMembers below). There is no
  // standalone subject picker; this is the only way to set it.
  const [hideFromId, setHideFromId] = useState<string | null>(null);
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

  // Group members, used only to rank @mention candidates for the title
  // field now (the old standalone subject picker is gone). A failed fetch
  // just leaves the mention list empty rather than blocking the form.
  const [members, setMembers] = useState<GroupMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiService
      .getGroupMembers(groupId)
      .then((data) => {
        if (cancelled) return;
        setMembers(data);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[CreateEvent] failed to load group members for @mentions:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // @mention candidates for the title field — active members of this group,
  // minus the creator (you can't tag yourself).
  const mentionMembers: MentionMember[] = useMemo(
    () =>
      members
        .filter((m) => m.status === 'active' && m.user_id !== user?.id)
        .map((m) => ({ user_id: m.user_id, username: m.username || 'Member', role: m.role })),
    [members, user?.id]
  );

  const titleMention = useMentionAutocomplete({ members: mentionMembers, value: title, onChange: setTitle });

  // Who's actually mentioned in the title right now — the sole source of
  // "who can this bet be hidden from" (see MentionHidePanel).
  const mentionedMembers = useMemo(() => getMentionedMembers(title, mentionMembers), [title, mentionMembers]);

  // If a mention is deleted from the title, a previously-picked "hide from"
  // selection can point at someone no longer mentioned — clear it rather
  // than silently keep hiding the bet from someone the title no longer
  // names.
  useEffect(() => {
    if (hideFromId && !mentionedMembers.some((m) => m.user_id === hideFromId)) {
      setHideFromId(null);
    }
  }, [hideFromId, mentionedMembers]);

  const handleCreate = async () => {
    if (!user) {
      setSubmitError('You must be signed in to create an event.');
      return;
    }

    const errors = validateForm({ title, sideA, sideB });
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
        // Dollar consolidation: every wager stakes dollars now — no more
        // "play with W" vs "real money" choice, so this always sends
        // 'cash'. There is no stake input at creation — stake_amount is
        // omitted entirely; each bettor picks their own amount when they
        // place a bet.
        payment_type: 'cash',
        // subject_user_id/notify_subject are sent only when the "Hide this
        // bet from @x" panel is actually on — a mention alone is just text.
        subject_user_id: hideFromId ?? undefined,
        notify_subject: hideFromId ? false : undefined,
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
          label="Event"
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
        <MentionHidePanel mentionedMembers={mentionedMembers} hideFromId={hideFromId} onChange={setHideFromId} />

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
