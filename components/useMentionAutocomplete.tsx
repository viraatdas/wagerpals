'use client';

// Shared @mention-autocomplete machinery for text controls: originally lived
// entirely inside CommentForm.tsx (the comment box), extracted so any other
// text input (e.g. the event title field in app/create/page.tsx) can offer
// the identical UX — same trigger regex, same candidate ranking, same
// keyboard/caret behavior — without a second, drifting implementation.
//
// Deliberately framework-light but NOT isomorphic like lib/comments.ts: this
// file uses React hooks and the DOM (HTMLInputElement/HTMLTextAreaElement),
// so it stays a 'use client' component module, not something imported from
// a server route.

import { useEffect, useId, useRef, useState, type RefObject } from 'react';

export interface MentionMember {
  user_id: string;
  username: string;
  role?: string;
}

// Trailing "@token" at the caret, preceded by start-of-string or a word boundary char.
const MENTION_TOKEN_RE = /(?:^|[\s([{"',:;\-])@([A-Za-z0-9_]{0,20})$/;

export function getMentionCandidates(members: MentionMember[], query: string): MentionMember[] {
  const q = query.toLowerCase();
  const byId = new Map<string, MentionMember>();
  for (const member of members) {
    if (byId.has(member.user_id)) continue;
    if (member.username.toLowerCase().startsWith(q)) {
      byId.set(member.user_id, member);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => a.username.localeCompare(b.username))
    .slice(0, 6);
}

export interface UseMentionAutocompleteOptions {
  members: MentionMember[];
  value: string;
  onChange: (next: string) => void;
}

export interface UseMentionAutocompleteResult<T extends HTMLInputElement | HTMLTextAreaElement> {
  popupOpen: boolean;
  candidates: MentionMember[];
  clampedHighlight: number;
  listboxId: string;
  activeOptionId: string | undefined;
  inputRef: RefObject<T>;
  /** Call from onChange/onKeyUp/onClick with the live element to re-derive the mention token at the caret. */
  updateFromElement: (el: T) => void;
  /** Call from onKeyDown while the popup may be open. Returns true if the key was consumed (caller should stop further handling). */
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  acceptMention: (candidate: MentionMember) => void;
  close: () => void;
}

export function useMentionAutocomplete<T extends HTMLInputElement | HTMLTextAreaElement>({
  members,
  value,
  onChange,
}: UseMentionAutocompleteOptions): UseMentionAutocompleteResult<T> {
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(0); // index of '@' within value
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [caretVersion, setCaretVersion] = useState(0);

  const inputRef = useRef<T>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const listboxId = useId();

  const candidates = mentionOpen ? getMentionCandidates(members, mentionQuery) : [];
  const popupOpen = mentionOpen && candidates.length > 0;
  const clampedHighlight = candidates.length > 0 ? Math.min(highlightIndex, candidates.length - 1) : 0;
  const activeOptionId = popupOpen ? `${listboxId}-option-${clampedHighlight}` : undefined;

  // Reset the highlighted candidate whenever the query text changes.
  useEffect(() => {
    setHighlightIndex(0);
  }, [mentionQuery]);

  // Restore focus + caret position after accepting a mention. Keyed on a
  // version counter (not the caret value itself) and read from a ref so the
  // effect never re-fires/cancels itself from its own cleanup; the extra
  // requestAnimationFrame ensures we run after React has flushed the new
  // value to the DOM.
  useEffect(() => {
    const pos = pendingCaretRef.current;
    if (pos === null) return;
    const raf = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
    pendingCaretRef.current = null;
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretVersion]);

  function updateFromElement(el: T) {
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const match = before.match(MENTION_TOKEN_RE);
    if (match) {
      const query = match[1].toLowerCase();
      const atIndex = caret - match[1].length - 1;
      setMentionOpen(true);
      setMentionQuery(query);
      setMentionStart(atIndex);
    } else {
      setMentionOpen(false);
    }
  }

  function acceptMention(candidate: MentionMember) {
    const tokenEnd = mentionStart + 1 + mentionQuery.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(tokenEnd);
    const insertion = `@${candidate.username} `;
    onChange(`${before}${insertion}${after}`);
    setMentionOpen(false);
    setMentionQuery('');
    pendingCaretRef.current = before.length + insertion.length;
    setCaretVersion((v) => v + 1);
  }

  function handleKeyDown(e: React.KeyboardEvent): boolean {
    if (!popupOpen) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % candidates.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => (i - 1 + candidates.length) % candidates.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      acceptMention(candidates[clampedHighlight]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setMentionOpen(false);
      return true;
    }
    return false;
  }

  function close() {
    setMentionOpen(false);
  }

  return {
    popupOpen,
    candidates,
    clampedHighlight,
    listboxId,
    activeOptionId,
    inputRef,
    updateFromElement,
    handleKeyDown,
    acceptMention,
    close,
  };
}

/**
 * Single-letter initial for the popup's avatar chip — mirrors
 * AvatarStack.tsx's rule (one letter, not two, so a row of chips doesn't
 * read as alphabet soup).
 */
function initialFor(username: string): string {
  const trimmed = username.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

export interface MentionAutocompleteMenuProps {
  listboxId: string;
  candidates: MentionMember[];
  clampedHighlight: number;
  onPick: (member: MentionMember) => void;
}

/**
 * The popup itself — an amber-avatar candidate list. Shared by CommentForm's
 * comment box and the event title field so they render pixel-identical
 * mention popups. Expects to be the only absolutely-positioned child of a
 * `position: relative` wrapper around the text control.
 */
export function MentionAutocompleteMenu({
  listboxId,
  candidates,
  clampedHighlight,
  onPick,
}: MentionAutocompleteMenuProps) {
  return (
    <div
      id={listboxId}
      role="listbox"
      className="card absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-auto py-1 shadow-elev-3"
    >
      {candidates.map((member, i) => (
        <button
          key={member.user_id}
          id={`${listboxId}-option-${i}`}
          type="button"
          role="option"
          aria-selected={i === clampedHighlight}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(member)}
          className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition ${
            i === clampedHighlight
              ? 'tone-pending tone-text bg-[var(--tone-fill)]'
              : 'text-foreground hover:bg-surface-sunken'
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex h-6 w-6 flex-none items-center justify-center overflow-hidden rounded-pill border-2 border-amber bg-amber/15 font-sans text-xs font-semibold text-amber-ink"
            >
              {initialFor(member.username)}
            </span>
            <span className="truncate font-medium">@{member.username}</span>
          </span>
          {member.role && <span className="flex-none text-xs text-muted">{member.role}</span>}
        </button>
      ))}
    </div>
  );
}
