'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MAX_COMMENT_LENGTH, validateCommentContent } from '@/lib/comments';

export interface MentionMember {
  user_id: string;
  username: string;
  role?: string;
}

export interface CommentFormProps {
  members?: MentionMember[]; // @autocomplete source (active group members)
  initialContent?: string; // prefilled text for edit mode
  submitLabel?: string; // default 'Post Comment'
  pendingLabel?: string; // default 'Posting…'
  placeholder?: string; // default 'Add a comment…  (@ to mention)'
  autoFocus?: boolean;
  maxLength?: number; // default MAX_COMMENT_LENGTH from '@/lib/comments'
  disabled?: boolean;
  compact?: boolean; // tighter padding + 2 rows, used for replies/edits
  onSubmit: (content: string) => Promise<void>; // rejects -> keep the text, show the error
  onCancel?: () => void; // when provided, render a Cancel button
}

// Trailing "@token" at the caret, preceded by start-of-string or a word boundary char.
const MENTION_TOKEN_RE = /(?:^|[\s([{"',:;\-])@([A-Za-z0-9_]{0,20})$/;

function getMentionCandidates(members: MentionMember[], query: string): MentionMember[] {
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

export default function CommentForm({
  members = [],
  initialContent = '',
  submitLabel = 'Post Comment',
  pendingLabel = 'Posting…',
  placeholder = 'Add a comment…  (@ to mention)',
  autoFocus = false,
  maxLength = MAX_COMMENT_LENGTH,
  disabled = false,
  compact = false,
  onSubmit,
  onCancel,
}: CommentFormProps) {
  const [content, setContent] = useState(initialContent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(0); // index of '@' within content
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [caretVersion, setCaretVersion] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const listboxId = useId();

  // Edit forms (non-empty initialContent) are unmounted by the parent after
  // submit, so we only clear our own state when we started out empty.
  const wasInitiallyEmpty = initialContent.trim().length === 0;

  const candidates = mentionOpen ? getMentionCandidates(members, mentionQuery) : [];
  const popupOpen = mentionOpen && candidates.length > 0;
  const clampedHighlight = candidates.length > 0 ? Math.min(highlightIndex, candidates.length - 1) : 0;

  // Reset the highlighted candidate whenever the query text changes.
  useEffect(() => {
    setHighlightIndex(0);
  }, [mentionQuery]);

  // Restore focus + caret position after accepting a mention. Keyed on a
  // version counter (not the caret value itself) and read from a ref so the
  // effect never re-fires/cancels itself from its own cleanup; the extra
  // requestAnimationFrame ensures we run after React has flushed the new
  // textarea value to the DOM.
  useEffect(() => {
    const pos = pendingCaretRef.current;
    if (pos === null) return;
    const raf = requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
    pendingCaretRef.current = null;
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretVersion]);

  function updateMentionState(el: HTMLTextAreaElement) {
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
    const before = content.slice(0, mentionStart);
    const after = content.slice(tokenEnd);
    const insertion = `@${candidate.username} `;
    setContent(`${before}${insertion}${after}`);
    setMentionOpen(false);
    setMentionQuery('');
    pendingCaretRef.current = before.length + insertion.length;
    setCaretVersion((v) => v + 1);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    if (error) setError(null);
    updateMentionState(e.target);
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (popupOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        acceptMention(candidates[clampedHighlight]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel?.();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();

    const result = validateCommentContent(content);
    if (!result.valid) {
      setError(result.error ?? 'Invalid comment');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(result.value ?? content);
      if (wasInitiallyEmpty) {
        setContent('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  const usedLength = Array.from(content).length;
  const remaining = maxLength - usedLength;
  const showCounter = remaining <= 200;
  const overLimit = usedLength >= maxLength;
  const submitDisabled = submitting || disabled || content.trim().length === 0;

  return (
    <form onSubmit={handleSubmit} className={`glass rounded-2xl ${compact ? 'p-3' : 'p-4'}`}>
      <div className="relative mb-3">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleTextareaKeyDown}
          onKeyUp={(e) => updateMentionState(e.currentTarget)}
          onClick={(e) => updateMentionState(e.currentTarget)}
          rows={compact ? 2 : 3}
          maxLength={maxLength}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled || submitting}
          aria-autocomplete="list"
          aria-expanded={popupOpen}
          aria-controls={listboxId}
          className="w-full bg-white border border-gray-300 text-foreground placeholder:text-muted-2 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-brand-2 focus:ring-2 focus:ring-brand-2/20 transition disabled:opacity-60 disabled:cursor-not-allowed"
        />

        {popupOpen && (
          <div
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg py-1"
          >
            {candidates.map((member, i) => (
              <button
                key={member.user_id}
                type="button"
                role="option"
                aria-selected={i === clampedHighlight}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => acceptMention(member)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition ${
                  i === clampedHighlight ? 'bg-brand-2/10 text-brand-2' : 'text-foreground hover:bg-gray-50'
                }`}
              >
                <span className="font-medium">@{member.username}</span>
                {member.role && <span className="text-xs text-muted-2">{member.role}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600 mb-2">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5 min-w-0">
          {!compact && <span className="text-xs text-muted-2">@ to mention · ⌘⏎ to post</span>}
          {showCounter && (
            <span className={`text-xs tabular-nums ${overLimit ? 'text-red-600' : 'text-muted-2'}`}>
              {usedLength}/{maxLength}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="btn-glass text-sm px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={submitDisabled}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {submitting ? pendingLabel : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
