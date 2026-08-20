// MentionHidePanel — replaces the old standalone "this bet is about someone"
// subject picker. There is no picker anymore: who a bet can be hidden from
// is detected entirely from @mentions already typed into the title (see
// ../utils/mentions.ts getMentionedMembers). This panel just offers the
// hide toggle for whoever is currently mentioned, and renders nothing at
// all when no one is mentioned.
//
// New file, not part of the (frozen) shared kit barrel: only
// CreateEventScreen.tsx and CreateEventFromInviteScreen.tsx use it, same
// convention as MentionSuggestions.tsx.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, spacing, tokens } from '../theme';
import { selectionTick } from '../utils/haptics';
import { handle } from '../utils/format';
import { Toggle } from './Toggle';
import type { MentionMember } from '../utils/mentions';

export interface MentionHidePanelProps {
  mentionedMembers: MentionMember[];
  hideFromId: string | null;
  onChange: (id: string | null) => void;
}

export function MentionHidePanel({ mentionedMembers, hideFromId, onChange }: MentionHidePanelProps) {
  if (mentionedMembers.length === 0) return null;

  if (mentionedMembers.length === 1) {
    const member = mentionedMembers[0];
    const hiding = hideFromId === member.user_id;
    return (
      <View style={styles.wrap}>
        <Toggle
          label={`Hide this bet from ${handle(member.username)}`}
          value={hiding}
          onValueChange={(next) => onChange(next ? member.user_id : null)}
          description={hiding ? "They won't see this bet anywhere." : undefined}
        />
      </View>
    );
  }

  const handlePick = (id: string) => {
    selectionTick();
    onChange(hideFromId === id ? null : id);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Keep it secret from them</Text>
      <View style={styles.chipRow}>
        {mentionedMembers.map((member) => {
          const selected = hideFromId === member.user_id;
          return (
            <Pressable
              key={member.user_id}
              onPress={() => handlePick(member.user_id)}
              accessibilityRole="button"
              accessibilityLabel={`Hide from ${handle(member.username)}`}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                pressed && styles.chipPressed,
              ]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
                {handle(member.username)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>Pick who shouldn&apos;t see it. One person max for now.</Text>
      {hideFromId ? <Text style={styles.hint}>They won&apos;t see this bet anywhere.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: tokens.color.amberFill,
    borderWidth: 1,
    borderColor: tokens.color.amber,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.sm,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderColor: tokens.color.amber,
    backgroundColor: tokens.color.amberFill,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipSelected: {
    backgroundColor: tokens.color.amber,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipText: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.xs,
    color: tokens.color.amberInk,
  },
  chipTextSelected: {
    color: colors.white,
  },
  hint: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
    marginTop: spacing.sm,
  },
});
