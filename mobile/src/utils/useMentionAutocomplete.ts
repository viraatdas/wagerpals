// RN-flavored twin of components/useMentionAutocomplete.tsx (web): same
// trigger/candidate rules (see ./mentions.ts), adapted to React Native's
// controlled-TextInput + onSelectionChange model instead of DOM caret APIs.
// Shared by CreateEventScreen.tsx and CreateEventFromInviteScreen.tsx.

import { useEffect, useMemo, useRef, useState } from 'react';
import { TextInput, type TextInputSelectionChangeEvent } from 'react-native';
import {
  acceptMentionToken,
  findMentionToken,
  getMentionCandidates,
  type MentionMember,
  type MentionToken,
} from './mentions';

export interface UseMentionAutocompleteOptions {
  members: MentionMember[];
  value: string;
  onChange: (next: string) => void;
}

export interface UseMentionAutocompleteResult {
  candidates: MentionMember[];
  isOpen: boolean;
  inputRef: React.RefObject<TextInput | null>;
  onSelectionChange: (e: TextInputSelectionChangeEvent) => void;
  acceptMention: (member: MentionMember) => void;
}

export function useMentionAutocomplete({
  members,
  value,
  onChange,
}: UseMentionAutocompleteOptions): UseMentionAutocompleteResult {
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [token, setToken] = useState<MentionToken | null>(null);
  const inputRef = useRef<TextInput | null>(null);

  // Re-derive the in-progress mention token whenever the text or the caret
  // moves. A non-collapsed selection (an actual text range highlighted)
  // never counts as "inside a mention token".
  useEffect(() => {
    if (selection.start !== selection.end) {
      setToken(null);
      return;
    }
    setToken(findMentionToken(value, selection.start));
  }, [value, selection]);

  const candidates = useMemo(() => (token ? getMentionCandidates(members, token.query) : []), [members, token]);
  const isOpen = token !== null && candidates.length > 0;

  function onSelectionChange(e: TextInputSelectionChangeEvent) {
    setSelection(e.nativeEvent.selection);
  }

  function acceptMention(member: MentionMember) {
    if (!token) return;
    const { text, caret } = acceptMentionToken(value, token, member);
    onChange(text);
    setToken(null);
    setSelection({ start: caret, end: caret });
    // Restore the caret after RN flushes the new value into the native
    // text field — setNativeProps is the pragmatic way to move the caret on
    // a controlled TextInput; there's no DOM-style setSelectionRange here.
    requestAnimationFrame(() => {
      inputRef.current?.setNativeProps({ selection: { start: caret, end: caret } });
    });
  }

  return { candidates, isOpen, inputRef, onSelectionChange, acceptMention };
}
