'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { validateUsername } from '@/lib/utils';

interface UsernameModalProps {
  onSubmit: (username: string) => Promise<void>;
}

export default function UsernameModal({ onSubmit }: UsernameModalProps) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUsername(value);

    // Real-time validation
    if (value.trim().length > 0) {
      const validation = validateUsername(value);
      setError(validation.valid ? null : validation.error || null);
    } else {
      setError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateUsername(username);

    if (!validation.valid) {
      setError(validation.error || 'Invalid username');
      return;
    }

    if (username.trim()) {
      try {
        setError(null);
        await onSubmit(username.trim());
      } catch (error: any) {
        setError(error.message || 'Failed to create username');
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card-focal animate-sheet max-w-md w-full p-8 relative overflow-hidden"
      >
        <div className="text-center mb-6 relative">
          <h2 id={titleId} className="display-2">
            Welcome to WagerPals
          </h2>
          <p className="text-muted mt-2">Pick your username to continue</p>
          <p className="text-sm text-muted mt-2">
            This is how friends will find you. You can change it later.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="relative">
          <div className="mb-6">
            <label htmlFor={inputId} className="field-label">
              Username
            </label>
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              inputMode="text"
              value={username}
              onChange={handleChange}
              onClick={(e) => e.currentTarget.focus()}
              onTouchStart={(e) => e.currentTarget.focus()}
              className={`input text-lg ${error ? 'input-invalid' : ''}`}
              placeholder="your username"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              required
              aria-invalid={!!error}
              aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
            />
            {error ? (
              <p id={`${inputId}-error`} className="tone-no tone-text text-sm font-medium mt-2">
                {error}
              </p>
            ) : (
              <p id={`${inputId}-hint`} className="field-hint mt-2">
                Letters, numbers, and underscores only.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!username.trim() || !!error}
            className="btn-primary w-full py-3 text-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            Continue
          </button>
        </form>

        <p className="field-hint text-center mt-6 relative">
          You&apos;re signed in — email and Google with the same address share one account.
        </p>
      </div>
    </div>
  );
}
