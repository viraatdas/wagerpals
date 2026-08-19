import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { colors, font, radius, spacing, tokens } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { Group, GroupMember, PaymentType } from '../types';
import { ApiError, toApiError } from '../utils/errors';
import { tapLight, tapMedium, selectionTick, success, error as hapticError } from '../utils/haptics';
import {
  FormScreen,
  Field,
  DateTimeField,
  AmountInput,
  SegmentedControl,
  Toggle,
  UserPicker,
  BottomSheet,
  Button,
  LoadingState,
  EmptyState,
  ErrorState,
  type SegmentedOption,
} from '../components';
import type { UserPickerUser } from '../components/UserPicker';

type InviteRouteProps = RouteProp<RootStackParamList, 'CreateEventFromInvite'>;

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
  group?: string;
  endTime?: string;
  stake?: string;
}

function validateForm(input: {
  title: string;
  sideA: string;
  sideB: string;
  selectedGroup: Group | null;
  endTime: number | null;
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

  if (!input.selectedGroup) {
    errors.group = 'Choose a group for this wager.';
  }

  if (input.endTime == null) {
    errors.endTime = 'Pick when this ends.';
  } else if (input.endTime <= Date.now()) {
    errors.endTime = 'End time must be in the future.';
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
    return "You're not an active member of that group, so you can't create events there.";
  }
  if (err.status === 400 && /subject/i.test(err.message)) {
    return 'The person you tagged is no longer an active member of this group. Remove the tag and try again.';
  }
  return err.userMessage;
}

/**
 * Parses the free-text `amount` query param from an iMessage-deep-link
 * invite into a safe positive number, or null if it's missing/garbage.
 * Never returns NaN — a malformed link must not crash or silently become
 * "$NaN".
 */
function parseInviteAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function CreateEventFromInviteScreen() {
  const route = useRoute<InviteRouteProps>();
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  // Audit finding D1: React Navigation leaves `params` undefined when a
  // matched deep link carries no query params at all (e.g. a bare
  // `https://wagerpals.io/invite`). Defaulting to `{}` here — instead of the
  // old destructure straight off `route.params` — is what stops that from
  // crashing with "Cannot read property 'title' of undefined".
  const params = route.params ?? {};
  const inviteTitle = params.title?.trim() || '';
  const inviteSideA = params.sideA?.trim() || '';
  const inviteSideB = params.sideB?.trim() || '';
  // A link is only useful as a preview if it carries all three core fields;
  // partial/garbled links fall back to the same "start from scratch" flow.
  const hasInviteBasics = !!(inviteTitle && inviteSideA && inviteSideB);
  // `pick` must actually name one of the two sides that came with THIS
  // invite — otherwise a malformed link could preselect a side that isn't
  // even on the event.
  const invitePick = params.pick && (params.pick === inviteSideA || params.pick === inviteSideB) ? params.pick : null;
  const inviteAmount = parseInviteAmount(params.amount);

  // Whether the user has moved past the "this link is incomplete" state,
  // either because the link WAS complete, or because they tapped "Create a
  // wager from scratch".
  const [showForm, setShowForm] = useState(hasInviteBasics);

  const [title, setTitle] = useState(inviteTitle);
  const [sideA, setSideA] = useState(inviteSideA);
  const [sideB, setSideB] = useState(inviteSideB);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [paymentType, setPaymentType] = useState<PaymentType>('none');
  const [stakeAmount, setStakeAmount] = useState('');
  const [subjectUserId, setSubjectUserId] = useState<string | null>(null);
  const [notifySubject, setNotifySubject] = useState(true);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isCreating, setIsCreating] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [groupsReloadKey, setGroupsReloadKey] = useState(0);

  useEffect(() => {
    if (!user) {
      setIsLoadingGroups(false);
      return;
    }
    let cancelled = false;
    setIsLoadingGroups(true);
    setGroupsError(null);
    apiService
      .getGroups(user.id)
      .then((data) => {
        if (cancelled) return;
        setGroups(data);
        // Prefer the group the invite link named, if it's one we're in;
        // otherwise auto-pick when there's only one candidate.
        const fromLink = params.groupId ? data.find((g) => g.id === params.groupId) : undefined;
        if (fromLink) {
          setSelectedGroup(fromLink);
        } else if (data.length === 1) {
          setSelectedGroup(data[0]);
        }
        setIsLoadingGroups(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/groups');
        setGroupsError(apiErr.userMessage);
        setIsLoadingGroups(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, groupsReloadKey]);

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

  // Subject-tagging candidates depend on which group is selected, so they
  // reload whenever that changes. Its own loading/error state so a slow or
  // failing members fetch never blocks the rest of the form.
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersReloadKey, setMembersReloadKey] = useState(0);

  useEffect(() => {
    if (!selectedGroup) {
      setMembers([]);
      setMembersError(null);
      setMembersLoading(false);
      return;
    }
    let cancelled = false;
    setMembersLoading(true);
    setMembersError(null);
    apiService
      .getGroupMembers(selectedGroup.id)
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
  }, [selectedGroup, membersReloadKey]);

  // Changing groups can invalidate a previously tagged subject who isn't a
  // member of the newly-selected group.
  useEffect(() => {
    setSubjectUserId(null);
    setNotifySubject(true);
  }, [selectedGroup?.id]);

  const subjectCandidates: UserPickerUser[] = useMemo(
    () =>
      members
        .filter((m) => m.status === 'active' && m.user_id !== user?.id)
        .map((m) => ({ id: m.user_id, username: m.username || 'Member' })),
    [members, user?.id]
  );

  const subjectUsername = subjectCandidates.find((u) => u.id === subjectUserId)?.username;

  // Group-level cash enablement (a parallel change adds `cash_enabled` to
  // GET /api/groups; POST /api/events now rejects payment_type: 'cash' for a
  // group where it's false). The shared Group type doesn't declare the field
  // yet, so it's read defensively off the raw response — a missing field
  // (older cached payload, or no group selected yet) is treated as disabled.
  const cashEnabled = (selectedGroup as any)?.cash_enabled ?? false;

  // Switching to a group without cash enabled falls back to the free/points
  // path gracefully instead of submitting a request the server will reject.
  useEffect(() => {
    if (!cashEnabled && paymentType === 'cash') {
      setPaymentType('none');
      setStakeAmount('');
    }
  }, [cashEnabled, paymentType]);

  const handleStartFromScratch = () => {
    tapLight();
    setShowForm(true);
  };

  const handleCreate = async () => {
    if (!user) {
      setSubmitError('You must be signed in to create an event.');
      return;
    }

    const errors = validateForm({ title, sideA, sideB, selectedGroup, endTime, paymentType, stakeAmount });
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    if (!creatorUsername) {
      setSubmitError(
        creatorUsernameError
          ? 'Could not load your profile — fix that above before creating an event.'
          : 'Still loading your profile — try again in a moment.'
      );
      return;
    }

    tapMedium();
    setSubmitError(null);
    setIsCreating(true);

    try {
      const newEvent = await apiService.createEvent({
        title: title.trim(),
        side_a: sideA.trim(),
        side_b: sideB.trim(),
        end_time: endTime as number,
        group_id: (selectedGroup as Group).id,
        creator_user_id: user.id,
        creator_username: creatorUsername,
        payment_type: paymentType,
        stake_amount: paymentType === 'cash' ? parseFloat(stakeAmount) : undefined,
        subject_user_id: subjectUserId ?? undefined,
        notify_subject: subjectUserId ? notifySubject : undefined,
      });

      // The suggested iMessage bet (pick + amount) is a separate, best-effort
      // action on top of event creation — its failure shouldn't undo an
      // otherwise-successful event create, so it's caught on its own.
      if (invitePick && inviteAmount != null) {
        try {
          await apiService.createBet({
            event_id: newEvent.id,
            user_id: user.id,
            username: creatorUsername,
            side: invitePick,
            amount: inviteAmount,
            note: 'Placed from iMessage',
          });
        } catch (betErr) {
          console.warn('[CreateEventFromInvite] suggested bet failed:', betErr);
        }
      }

      success();
      navigation.navigate('EventDetail' as never, { eventId: newEvent.id } as never);
    } catch (err) {
      hapticError();
      const apiErr = err instanceof ApiError ? err : toApiError(err, '/api/events');
      setSubmitError(describeCreateEventError(apiErr));
    } finally {
      setIsCreating(false);
    }
  };

  const canSubmit = !isCreating && !loadingCreator;

  // First-class "this invite link is incomplete" state — never render a
  // half-blank form when the deep link carried no usable data.
  if (!showForm) {
    return (
      <View style={styles.container}>
        <View style={styles.invalidWrap}>
          <EmptyState
            icon="link-outline"
            title="This invite link is incomplete"
            message="We couldn't find the wager details in that link. You can start a new wager from scratch, or head back home."
          />
          <View style={styles.invalidActions}>
            <Button title="Create a Wager From Scratch" onPress={handleStartFromScratch} icon="add-circle-outline" fullWidth />
            <Button
              title="Go Home"
              onPress={() => navigation.navigate('Main' as never)}
              variant="secondary"
              fullWidth
              style={styles.invalidSecondaryButton}
            />
          </View>
        </View>
      </View>
    );
  }

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
              icon="flash"
              loading={isCreating}
              disabled={!canSubmit}
              fullWidth
              haptic="none"
            />
          </>
        }
      >
        <Text style={styles.heading}>{hasInviteBasics ? 'Wager Invite' : 'Create a Wager'}</Text>
        <Text style={styles.subheading}>
          {hasInviteBasics ? 'Someone challenged you!' : 'Fill in the details below'}
        </Text>

        {creatorUsernameError ? (
          <ErrorState
            compact
            title="Couldn't load your profile"
            message={creatorUsernameError}
            onRetry={() => setCreatorReloadKey((k) => k + 1)}
          />
        ) : null}

        {hasInviteBasics && invitePick && inviteAmount != null ? (
          <View style={styles.suggestedBetBox}>
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.brand2} />
            <Text style={styles.suggestedBetText}>
              iMessage bet: ${inviteAmount} on {invitePick}
            </Text>
          </View>
        ) : null}

        <Field
          label="Event Title"
          value={title}
          onChangeText={(t) => {
            setTitle(t);
            if (formErrors.title) setFormErrors((prev) => ({ ...prev, title: undefined }));
          }}
          placeholder="Will it rain tomorrow?"
          error={formErrors.title}
          maxLength={MAX_TITLE_LENGTH}
          showCount
          returnKeyType="next"
        />

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

        <Text style={styles.sectionLabel}>Select Group</Text>
        {isLoadingGroups ? (
          <LoadingState compact label="Loading your groups…" />
        ) : groupsError ? (
          <ErrorState compact message={groupsError} onRetry={() => setGroupsReloadKey((k) => k + 1)} />
        ) : groups.length === 0 ? (
          <EmptyState
            compact
            icon="people-outline"
            title="No groups yet"
            message="You're not in any groups yet. Join or create one first."
            actionLabel="Go to Home"
            onAction={() => navigation.navigate('Main' as never)}
          />
        ) : (
          <>
            <Pressable
              style={({ pressed }) => [
                styles.groupPickerButton,
                formErrors.group && styles.groupPickerButtonError,
                pressed && styles.groupPickerButtonPressed,
              ]}
              onPress={() => {
                tapLight();
                setShowGroupPicker(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={selectedGroup ? `Group: ${selectedGroup.name}` : 'Choose a group'}
            >
              {selectedGroup ? (
                <View style={styles.selectedGroupRow}>
                  <View style={styles.groupAvatar}>
                    <Text style={styles.groupAvatarText}>{selectedGroup.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.selectedGroupInfo}>
                    <Text style={styles.selectedGroupName} numberOfLines={1}>
                      {selectedGroup.name}
                    </Text>
                    <Text style={styles.selectedGroupMeta}>{selectedGroup.member_count ?? 0} members</Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.groupPickerPlaceholder}>Choose a group...</Text>
              )}
              <Ionicons name="chevron-down" size={20} color={colors.textFaint} />
            </Pressable>
            {formErrors.group ? (
              <View style={styles.fieldErrorRow}>
                <Ionicons name="alert-circle" size={14} color={colors.rose} />
                <Text style={styles.fieldErrorText}>{formErrors.group}</Text>
              </View>
            ) : null}
          </>
        )}

        <DateTimeField
          label="When does this end?"
          value={endTime}
          onChange={(ts) => {
            setEndTime(ts);
            if (formErrors.endTime) setFormErrors((prev) => ({ ...prev, endTime: undefined }));
          }}
          minimumDate={new Date()}
          error={formErrors.endTime}
        />

        {selectedGroup && cashEnabled ? (
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

        {selectedGroup ? (
          <>
            <Text style={styles.sectionLabel}>Tag Someone (optional)</Text>
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
                  placeholder="No one — general bet"
                  hint="Tag the group member this wager is about."
                />
                {subjectUserId ? (
                  <Toggle
                    label={`Notify ${subjectUsername ?? 'them'}`}
                    value={notifySubject}
                    onValueChange={setNotifySubject}
                    description={
                      notifySubject
                        ? undefined
                        : `Quiet bet — ${subjectUsername ?? 'they'} won't be notified.`
                    }
                  />
                ) : null}
              </>
            )}
          </>
        ) : null}

        {/* Fallback: bail out to the app without creating anything */}
        <Pressable
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('Main' as never)}
          accessibilityRole="button"
          accessibilityLabel="Skip and open WagerPals"
        >
          <Text style={styles.secondaryButtonText}>Skip and Open WagerPals</Text>
        </Pressable>
      </FormScreen>

      {/* Group Picker Sheet */}
      <BottomSheet visible={showGroupPicker} onClose={() => setShowGroupPicker(false)} title="Select Group">
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          style={styles.modalList}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.groupListItem,
                selectedGroup?.id === item.id && styles.groupListItemSelected,
                pressed && styles.groupListItemPressed,
              ]}
              onPress={() => {
                selectionTick();
                setSelectedGroup(item);
                setFormErrors((prev) => ({ ...prev, group: undefined }));
                setShowGroupPicker(false);
              }}
              accessibilityRole="button"
              accessibilityLabel={item.name}
              accessibilityState={{ selected: selectedGroup?.id === item.id }}
            >
              <View style={[styles.groupAvatar, selectedGroup?.id === item.id && styles.groupAvatarSelected]}>
                <Text style={styles.groupAvatarText}>{item.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.groupListInfo}>
                <Text style={styles.groupListName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.groupListMeta}>{item.member_count ?? 0} members</Text>
              </View>
              {selectedGroup?.id === item.id ? (
                <Ionicons name="checkmark-circle" size={24} color={colors.brand2} />
              ) : null}
            </Pressable>
          )}
        />
      </BottomSheet>
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
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subheading: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  sectionLabel: {
    fontSize: tokens.fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: spacing.sm,
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

  // Invalid-invite state
  invalidWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  invalidActions: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  invalidSecondaryButton: {
    marginTop: 0,
  },

  // Suggested bet banner
  suggestedBetBox: {
    marginBottom: spacing.lg,
    backgroundColor: colors.brandFill,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  suggestedBetText: {
    color: colors.brand2,
    fontSize: tokens.fontSize.sm,
    fontWeight: '600',
    flexShrink: 1,
  },

  // Group picker button
  groupPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  groupPickerButtonError: {
    borderColor: colors.rose,
  },
  groupPickerButtonPressed: {
    opacity: 0.7,
  },
  groupPickerPlaceholder: {
    fontSize: tokens.fontSize.base,
    color: colors.textFaint,
  },
  fieldErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    minHeight: 16,
  },
  fieldErrorText: {
    fontSize: tokens.fontSize.xs,
    color: colors.rose,
    flexShrink: 1,
  },
  selectedGroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  groupAvatar: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.brandFill,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupAvatarSelected: {
    backgroundColor: colors.brandFill,
    borderColor: colors.brand2,
  },
  groupAvatarText: {
    color: colors.brand2,
    fontSize: tokens.fontSize.base,
    fontWeight: '700',
  },
  selectedGroupInfo: {
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
  },
  selectedGroupName: {
    fontSize: tokens.fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  selectedGroupMeta: {
    fontSize: tokens.fontSize.xs,
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

  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  secondaryButtonText: {
    color: colors.textMuted,
    fontSize: tokens.fontSize.sm,
    fontWeight: '500',
  },

  modalList: {
    maxHeight: 420,
  },
  groupListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    minHeight: 44,
  },
  groupListItemSelected: {
    borderColor: colors.brand2,
    backgroundColor: colors.brandFill,
  },
  groupListItemPressed: {
    opacity: 0.7,
  },
  groupListInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  groupListName: {
    fontSize: tokens.fontSize.base,
    fontWeight: '600',
    color: colors.text,
  },
  groupListMeta: {
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
  },
});
