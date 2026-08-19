'use client';

import { useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  isOpen: boolean;
  onClose: () => void;
  message: string;
  type?: ToastType;
  duration?: number;
}

const TONE_BY_TYPE: Record<ToastType, string> = {
  success: 'tone-yes',
  error: 'tone-no',
  warning: 'tone-pending',
  info: 'tone-info',
};

const ICON_BY_TYPE: Record<ToastType, JSX.Element> = {
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.5}
        d="M12 9v4m0 4h.01M10.29 3.86l-8.18 14.14A1 1 0 003 19.5h18a1 1 0 00.89-1.5L13.71 3.86a1 1 0 00-1.72 0z"
      />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

export default function Toast({
  isOpen,
  onClose,
  message,
  type = 'info',
  duration = 3000,
}: ToastProps) {
  useEffect(() => {
    if (isOpen && duration > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose, duration]);

  if (!isOpen) return null;

  const tone = TONE_BY_TYPE[type];
  const isError = type === 'error';

  return (
    <div className="pointer-events-none fixed left-4 right-4 top-20 z-[60] flex justify-center sm:left-auto sm:right-4 sm:justify-end">
      <div
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        className={`${tone} rail animate-sheet pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-control border border-line bg-card p-4 pl-5 shadow-elev-2`}
      >
        <div className="tone-surface tone-text flex h-8 w-8 flex-none items-center justify-center rounded-pill border">
          {ICON_BY_TYPE[type]}
        </div>
        <p className="flex-1 pt-0.5 font-sans text-sm text-foreground">{message}</p>
        <button
          onClick={onClose}
          className="press flex-none text-muted-2 hover:text-foreground transition-colors"
          aria-label="Dismiss notification"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
