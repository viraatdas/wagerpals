'use client';

import { useEffect, useState } from 'react';
import { MAX_COMMENT_LENGTH, validateCommentContent } from '@/lib/comments';
import {
  useMentionAutocomplete,
  MentionAutocompleteMenu,
  type MentionMember,
} from '@/components/useMentionAutocomplete';
import { handle } from '@/lib/utils';

export type { MentionMember };

export interface CommentFormProps {
  members?: MentionMember[]; // @autocomplete source (active group members)
  initialContent?: string; // prefilled text for edit mode
  submitLabel?: string; // default 'Post comment'
  pendingLabel?: string; // default 'Posting…'
  placeholder?: string; // default 'Add a comment… (@ to mention)'
  autoFocus?: boolean;
  maxLength?: number; // default MAX_COMMENT_LENGTH from '@/lib/comments'
  disabled?: boolean;
  compact?: boolean; // tighter padding + 2 rows, used for replies/edits
  // Presentational only: when set, renders a "Replying to @x" bar above the
  // textarea. Does not affect submission, payloads, or validation.
  replyingToUsername?: string | null;
  // Presentational only: lets a caller (e.g. an empty-state "write the first
  // comment" action) focus this specific textarea via document.getElementById.
  textareaId?: string;
  onSubmit: (content: string) => Promise<void>; // rejects -> keep the text, show the error
  onCancel?: () => void; // when provided, render a Cancel button
}

export default function CommentForm({
  members = [],
  initialContent = '',
  submitLabel = 'Post comment',
  pendingLabel = 'Posting…',
  placeholder = 'Add a comment… (@ to mention)',
  autoFocus = false,
  maxLength = MAX_COMMENT_LENGTH,
  disabled = false,
  compact = false,
  replyingToUsername = null,
  textareaId,
  onSubmit,
  onCancel,
}: CommentFormProps) {
  const [content, setContent] = useState(initialContent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    popupOpen,
    candidates,
    clampedHighlight,
    listboxId,
    activeOptionId,
    inputRef: textareaRef,
    updateFromElement: updateMentionState,
    handleKeyDown: handleMentionKeyDown,
    acceptMention,
  } = useMentionAutocomplete<HTMLTextAreaElement>({ members, value: content, onChange: setContent });

  // Edit forms (non-empty initialContent) are unmounted by the parent after
  // submit, so we only clear our own state when we started out empty.
  const wasInitiallyEmpty = initialContent.trim().length === 0;

  // Presentational only: let the textarea grow with its content instead of
  // scrolling internally, up to the browser's natural sizing.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [content, compact, textareaRef]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    if (error) setError(null);
    updateMentionState(e.target);
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (handleMentionKeyDown(e)) return;

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
      setError(err instanceof Error ? err.message : "Couldn't post that. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const usedLength = Array.from(content).length;
  const remaining = maxLength - usedLength;
  const showCounter = remaining <= 200;
  const overLimit = usedLength >= maxLength;
  const counterTone = overLimit || remaining <= 20 ? 'tone-no' : 'tone-pending';
  const submitDisabled = submitting || disabled || content.trim().length === 0;

  return (
    <form onSubmit={handleSubmit} className={`card ${compact ? 'p-3' : 'p-4'}`}>
      {replyingToUsername && (
        <div className="tone-pending tone-surface mb-2.5 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5">
          <span className="tone-text min-w-0 truncate text-xs font-medium">
            Replying to <span className="font-semibold">{handle(replyingToUsername)}</span>
          </span>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel reply"
              className="press tone-text shrink-0 text-xs font-medium hover:opacity-70"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      <div className="relative mb-3">
        <textarea
          id={textareaId}
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
          aria-activedescendant={activeOptionId}
          className={`input resize-none ${error ? 'input-invalid' : ''}`}
        />

        {popupOpen && (
          <MentionAutocompleteMenu
            listboxId={listboxId}
            candidates={candidates}
            clampedHighlight={clampedHighlight}
            onPick={acceptMention}
          />
        )}
      </div>

      {error && (
        <p role="alert" className="tone-no tone-text mb-2 text-xs">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5 min-w-0">
          {!compact && <span className="field-hint">@ to mention · ⌘⏎ to post</span>}
          {showCounter && (
            <span className={`${counterTone} tone-text text-xs font-medium tabular-nums`}>
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
