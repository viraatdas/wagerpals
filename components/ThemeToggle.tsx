'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

/**
 * Dark is WagerPals' default (see DESIGN.md) — light is an explicit opt-in, not
 * a system-preference follow. That is deliberate: the whole visual world is
 * built for a near-black room, so a light system setting shouldn't silently
 * hand someone a different product on first load.
 *
 * The theme is applied by the inline script in app/layout.tsx BEFORE first
 * paint. This component only renders the control and keeps it in sync — it must
 * never be the thing that first applies the class, or the page flashes dark
 * before switching.
 */
export const THEME_STORAGE_KEY = 'wagerpals-theme';

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export default function ThemeToggle({ className = '' }: { className?: string }) {
  // Start undefined so the button renders nothing theme-specific until mounted;
  // the server has no way to know which theme the browser will apply.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === 'light' ? 'dark' : 'light';
    // 'dark' is the default, so it is stored as the absence of the attribute.
    if (next === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — the toggle still works for this page.
    }
    setTheme(next);
  }, []);

  const isLight = theme === 'light';
  const label = theme === null ? 'Switch theme' : isLight ? 'Switch to dark mode' : 'Switch to light mode';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`press inline-flex h-9 w-9 items-center justify-center rounded-full border border-hairline bg-surface text-ink-secondary transition-colors hover:bg-surface-elevated hover:text-ink ${className}`}
    >
      {/* Sun and moon are drawn, not emoji — one 24px grid, 1.75 stroke. */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {isLight ? (
          // Currently light -> offer the moon
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        ) : (
          // Currently dark (or not yet known) -> offer the sun
          <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.2v2.2M12 19.6v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.2 12h2.2M19.6 12h2.2M4.4 19.6 6 18M18 6l1.6-1.6" />
          </>
        )}
      </svg>
    </button>
  );
}
