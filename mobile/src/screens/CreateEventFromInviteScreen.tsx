import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { colors, font, radius, spacing, tokens } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { useAuth } from '../hooks/useAuth';
import apiService from '../services/api';
import { Group, GroupMember } from '../types';
import { ApiError, toApiError } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { tapLight, tapMedium, selectionTick, success, error as hapticError } from '../utils/haptics';
import {
  FormScreen,
  Field,
  BottomSheet,
  Button,
  LoadingState,
  EmptyState,
  ErrorState,
} from '../components';
import { MentionSuggestions } from '../components/MentionSuggestions';
import { MentionHidePanel } from '../components/MentionHidePanel';
import { useMentionAutocomplete } from '../utils/useMentionAutocomplete';
import { getMentionedMembers, type MentionMember } from '../utils/mentions';

type InviteRouteProps = RouteProp<RootStackParamList, 'CreateEventFromInvite'>;

const MAX_TITLE_LENGTH = 100;
const MAX_SIDE_LENGTH = 40;

interface FormErrors {
  title?: string;
  sideA?: string;
  sideB?: string;
  group?: string;
}

function validateForm(input: {
  title: string;
  sideA: string;
  sideB: string;
  selectedGroup: Group | null;
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
  // Who this bet is hidden from, if anyone — see CreateEventScreen.tsx for
  // the same @mention-detection change. Always a member currently
  // @mentioned in the title; there is no standalone subject picker.
  const [hideFromId, setHideFromId] = useState<string | null>(null);
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

  // Group members, used only to rank @mention candidates for the title
  // field now (the old standalone subject picker is gone). Reloads whenever
  // the selected group changes; a failed fetch just leaves the mention list
  // empty rather than blocking the rest of the form.
  const [members, setMembers] = useState<GroupMember[]>([]);

  useEffect(() => {
    if (!selectedGroup) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    apiService
      .getGroupMembers(selectedGroup.id)
      .then((data) => {
        if (cancelled) return;
        setMembers(data);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[CreateEventFromInvite] failed to load group members for @mentions:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGroup]);

  // Changing groups can invalidate a previously tagged "hide from" selection
  // (they might not be in the new group's title anymore either way).
  useEffect(() => {
    setHideFromId(null);
  }, [selectedGroup?.id]);

  // @mention candidates for the title field — active members of the
  // selected group, minus the creator (you can't tag yourself).
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

  const handleStartFromScratch = () => {
    tapLight();
    setShowForm(true);
  };

  const handleCreate = async () => {
    if (!user) {
      setSubmitError('You must be signed in to create an event.');
      return;
    }

    const errors = validateForm({ title, sideA, sideB, selectedGroup });
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
    setIsCreating(true);

    try {
      const newEvent = await apiService.createEvent({
        title: title.trim(),
        side_a: sideA.trim(),
        side_b: sideB.trim(),
        // No-expiry rules: end_time is meaningless server-side now — don't
        // send one.
        group_id: (selectedGroup as Group).id,
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
              iMessage bet: {formatMoney(inviteAmount)} on {invitePick}
            </Text>
          </View>
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
