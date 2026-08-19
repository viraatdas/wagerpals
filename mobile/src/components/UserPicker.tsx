// UserPicker — collapsed row + searchable BottomSheet for tagging the
// SUBJECT of a bet (a bet *about* a specific group member, not a bet placed
// by them). Renders a real "no matches"/"no members yet" message instead of
// a blank list.
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, spacing, tokens } from '../theme';
import { selectionTick, tapLight } from '../utils/haptics';
import { handle } from '../utils/format';
import { BottomSheet } from './BottomSheet';

export interface UserPickerUser {
  id: string;
  username: string;
}

export interface UserPickerProps {
  label?: string;
  users: UserPickerUser[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  hint?: string;
  /** Show a "No one / general bet" row that clears the selection. */
  allowClear?: boolean;
}

function initialsFor(username: string): string {
  const trimmed = username.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

export function UserPicker({
  label,
  users,
  value,
  onChange,
  placeholder = 'Select a person',
  hint,
  allowClear = true,
}: UserPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedUser = users.find((u) => u.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.username.toLowerCase().includes(q));
  }, [users, query]);

  const handleOpen = () => {
    tapLight();
    setQuery('');
    setOpen(true);
  };

  const handlePick = (id: string | null) => {
    selectionTick();
    onChange(id);
    setOpen(false);
  };

  return (
    <View style={styles.container}>
      {label ? (
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      <Pressable
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={label ?? 'Select a person'}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        {selectedUser ? (
          <View style={styles.selectedRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initialsFor(selectedUser.username)}</Text>
            </View>
            <Text style={styles.selectedText} numberOfLines={1}>
              {handle(selectedUser.username)}
            </Text>
          </View>
        ) : (
          <Text style={styles.placeholder} numberOfLines={1}>
            {placeholder}
          </Text>
        )}
        <Ionicons name="chevron-down" size={18} color={colors.textFaint} />
      </Pressable>
      {hint ? (
        <Text style={styles.hint} numberOfLines={2}>
          {hint}
        </Text>
      ) : null}

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label ?? 'Select a person'}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.textFaint} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search people"
          />
        </View>
        {users.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="people-outline" size={24} color={colors.textFaint} />
            <Text style={styles.emptyText}>No group members to pick from yet.</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListHeaderComponent={
              allowClear ? (
                <Pressable
                  onPress={() => handlePick(null)}
                  accessibilityRole="button"
                  accessibilityLabel="No one / general bet"
                  accessibilityState={{ selected: value === null }}
                  style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                >
                  <View style={[styles.avatar, styles.avatarClear]}>
                    <Ionicons name="close" size={16} color={colors.textMuted} />
                  </View>
                  <Text style={styles.itemText} numberOfLines={1}>
                    No one / general bet
                  </Text>
                  {value === null ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.brand2} />
                  ) : null}
                </Pressable>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>No matches for "{query}".</Text>
              </View>
            }
            renderItem={({ item }) => {
              const selected = item.id === value;
              return (
                <Pressable
                  onPress={() => handlePick(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={handle(item.username)}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initialsFor(item.username)}</Text>
                  </View>
                  <Text style={styles.itemText} numberOfLines={1}>
                    {handle(item.username)}
                  </Text>
                  {selected ? <Ionicons name="checkmark-circle" size={20} color={colors.brand2} /> : null}
                </Pressable>
              );
            }}
          />
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  label: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  placeholder: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.base,
    color: colors.textFaint,
  },
  selectedText: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.base,
    color: colors.text,
  },
  // Person picker — Amber, the people accent (DESIGN-SPEC.md color rule),
  // matching Avatar's ring/tint treatment.
  avatar: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: tokens.color.amberFill,
    borderWidth: 1.5,
    borderColor: tokens.color.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarClear: {
    backgroundColor: colors.bg2,
    borderColor: colors.border,
  },
  avatarText: {
    fontFamily: font.sansSemiBold,
    fontSize: tokens.fontSize.xs,
    color: tokens.color.amberInk,
  },
  hint: {
    fontFamily: font.sans,
    marginTop: spacing.xs,
    fontSize: tokens.fontSize.xs,
    color: colors.textFaint,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    backgroundColor: colors.bg2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: font.sans,
    fontSize: tokens.fontSize.base,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  list: {
    maxHeight: 360,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  itemPressed: {
    opacity: 0.6,
  },
  itemText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    fontFamily: font.sans,
    fontSize: tokens.fontSize.base,
    color: colors.text,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    fontFamily: font.sans,
    fontSize: tokens.fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
