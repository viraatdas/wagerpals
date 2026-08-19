// Compact @mention suggestion list — renders directly under a title field
// while an in-progress '@token' is being typed. New file, not part of the
// (frozen) shared kit barrel: only CreateEventScreen.tsx and
// CreateEventFromInviteScreen.tsx use it, wired through
// ../utils/useMentionAutocomplete.
//
// Amber avatar + username per row, matching Avatar.tsx's "people are amber"
// convention (DESIGN-SPEC.md) — capped at 4 visible rows so it never grows
// tall enough to cover the rest of the form.
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { colors, font, radius, spacing, tokens } from '../theme';
import { selectionTick } from '../utils/haptics';
import { handle } from '../utils/format';
import type { MentionMember } from '../utils/mentions';

export interface MentionSuggestionsProps {
  candidates: MentionMember[];
  onPick: (member: MentionMember) => void;
}

const MAX_VISIBLE_ROWS = 4;
const ROW_HEIGHT = 44;

export function MentionSuggestions({ candidates, onPick }: MentionSuggestionsProps) {
  if (candidates.length === 0) return null;

  const visible = candidates.slice(0, MAX_VISIBLE_ROWS);

  const handlePick = (member: MentionMember) => {
    selectionTick();
    onPick(member);
  };

  return (
    <View style={styles.wrap} accessibilityRole="menu">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ maxHeight: ROW_HEIGHT * visible.length }}
        showsVerticalScrollIndicator={false}
      >
        {visible.map((member) => (
          <Pressable
            key={member.user_id}
            onPress={() => handlePick(member)}
            accessibilityRole="button"
            accessibilityLabel={`Mention ${handle(member.username)}`}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <Avatar username={member.username} size="sm" />
            <Text style={styles.username} numberOfLines={1}>
              {handle(member.username)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: -spacing.sm,
    marginBottom: spacing.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: ROW_HEIGHT,
    paddingHorizontal: spacing.md,
  },
  rowPressed: {
    opacity: 0.6,
  },
  username: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.sm,
    color: colors.text,
  },
});
