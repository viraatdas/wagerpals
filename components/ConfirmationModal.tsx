'use client';

import { useEffect } from 'react';

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
}

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
}: ConfirmationModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !loading) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, loading]);

  if (!isOpen) return null;

  const typeStyles = {
    danger: {
      icon: '🗑️',
      iconBg: 'bg-red-50 border border-red-200',
      iconColor: 'text-red-600',
      confirmBg: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-300',
    },
    warning: {
      icon: '⚠️',
      iconBg: 'bg-amber-50 border border-amber-200',
      iconColor: 'text-amber-600',
      confirmBg: 'bg-amber-600 text-white hover:bg-amber-700 focus:ring-amber-300',
    },
    success: {
      icon: '✓',
      iconBg: 'bg-green-50 border border-green-200',
      iconColor: 'text-green-600',
      confirmBg: 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-300',
    },
  };

  const styles = typeStyles[type];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 transition-opacity"
        onClick={loading ? undefined : onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white border border-gray-200 shadow-xl rounded-xl max-w-md w-full transform transition-all animate-slide-up overflow-hidden">
          {/* Icon */}
          <div className="flex items-center justify-center pt-6">
            <div className={`${styles.iconBg} ${styles.iconColor} rounded-full w-16 h-16 flex items-center justify-center`}>
              <span className="text-3xl">{styles.icon}</span>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-4 text-center">
            <h3 className="font-display text-xl font-semibold text-foreground mb-2">
              {title}
            </h3>
            <p className="text-muted">
              {message}
            </p>
          </div>

          {/* Actions */}
          <div className="px-6 pb-6 flex gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="btn-glass flex-1 px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-0"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className={`flex-1 px-4 py-2.5 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none focus:outline-none focus:ring-2 focus:ring-offset-0 ${styles.confirmBg}`}
            >
              {loading ? 'Processing...' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

