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

  const typeStyles = {
    success: {
      icon: '✓',
      accentColor: 'border-l-green-600',
      textColor: 'text-green-700',
      iconBg: 'bg-green-50',
    },
    error: {
      icon: '✕',
      accentColor: 'border-l-red-600',
      textColor: 'text-red-700',
      iconBg: 'bg-red-50',
    },
    warning: {
      icon: '⚠',
      accentColor: 'border-l-amber-500',
      textColor: 'text-amber-700',
      iconBg: 'bg-amber-50',
    },
    info: {
      icon: 'ℹ',
      accentColor: 'border-l-sky-600',
      textColor: 'text-sky-700',
      iconBg: 'bg-sky-50',
    },
  };

  const styles = typeStyles[type];

  return (
    <div className="fixed left-4 right-4 top-20 z-[60] animate-fade-in sm:left-auto sm:right-4">
      <div className={`bg-white border border-gray-200 border-l-4 ${styles.accentColor} shadow-lg rounded-xl p-4 max-w-md flex items-start gap-3`}>
        <div className={`${styles.iconBg} rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0`}>
          <span className={`${styles.textColor} font-semibold text-lg`}>{styles.icon}</span>
        </div>
        <div className="flex-1">
          <p className="text-foreground">{message}</p>
        </div>
        <button
          onClick={onClose}
          className="text-muted-2 hover:text-foreground transition-colors flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
