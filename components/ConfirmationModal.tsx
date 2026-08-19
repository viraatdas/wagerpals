'use client';

import { useEffect, useId, useRef } from 'react';

export type ConfirmationType = 'danger' | 'warning' | 'success';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: ConfirmationType;
  loading?: boolean;
  /**
   * Per-action loading label shown on the confirm button while `loading` is
   * true, e.g. "Deleting bet…". Every flow needs its own verb — a single
   * generic "Processing..." loses the verb identity a button/confirmation
   * pair is supposed to carry through. Defaults to a naive gerund of
   * `confirmText` (e.g. "Resolve" -> "Resolving…") for callers that don't
   * pass one, but callers with an irregular verb (e.g. "Cancel & Refund")
   * should pass an explicit label.
   */
  loadingText?: string;
}

/** Naive fallback gerund for `confirmText` when no explicit `loadingText` is given. */
function defaultLoadingLabel(confirmText: string): string {
  const trimmed = confirmText.trim();
  if (!trimmed) return 'Working…';
  return /e$/i.test(trimmed) ? `${trimmed.slice(0, -1)}ing…` : `${trimmed}ing…`;
}

const TONE_BY_TYPE: Record<ConfirmationType, string> = {
  danger: 'tone-no',
  warning: 'tone-pending',
  success: 'tone-yes',
};

const CONFIRM_CLASS_BY_TYPE: Record<ConfirmationType, string> = {
  danger: 'btn-danger',
  warning: 'btn-primary',
  success: 'btn-success',
};

const ICON_BY_TYPE: Record<ConfirmationType, JSX.Element> = {
  danger: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-7 w-7">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9.5 4h5a1 1 0 011 1v2h-7V5a1 1 0 011-1z"
      />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-7 w-7">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v4m0 4h.01M10.29 3.86l-8.18 14.14A1 1 0 003 19.5h18a1 1 0 00.89-1.5L13.71 3.86a1 1 0 00-1.72 0z"
      />
    </svg>
  ),
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-7 w-7">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
};

export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'danger',
  loading = false,
  loadingText,
}: ConfirmationModalProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !loading) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      confirmRef.current?.focus();
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, loading]);

  if (!isOpen) return null;

  const tone = TONE_BY_TYPE[type];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 transition-opacity"
        onClick={loading ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="card-focal animate-sheet relative w-full max-w-md overflow-hidden"
        >
          {/* Icon */}
          <div className="flex items-center justify-center pt-6">
            <div className={`${tone} tone-surface tone-text flex h-16 w-16 items-center justify-center rounded-full border`}>
              {ICON_BY_TYPE[type]}
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-4 text-center">
            <h3 id={titleId} className="display-3">
              {title}
            </h3>
            <p className="mt-2 text-muted">
              {message}
            </p>
          </div>

          {/* Actions */}
          <div className="px-6 pb-6 flex gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="btn-glass flex-1 px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelText}
            </button>
            <button
              ref={confirmRef}
              onClick={onConfirm}
              disabled={loading}
              className={`${CONFIRM_CLASS_BY_TYPE[type]} flex-1 px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none`}
            >
              {loading ? loadingText ?? defaultLoadingLabel(confirmText) : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
