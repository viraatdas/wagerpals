'use client';

import { useLayoutEffect } from 'react';
import { THEME_STORAGE_KEY } from './ThemeToggle';

function applyStoredTheme(): void {
  try {
    if (window.localStorage.getItem(THEME_STORAGE_KEY) === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  } catch {
    // Storage disabled — fall through to the default dark theme.
  }
}

/**
 * Applies the saved theme as early as the client bundle can manage.
 *
 * Why this is a module-level side effect rather than the usual inline
 * <script dangerouslySetInnerHTML> in the layout: this app renders entirely on
 * the client. `curl` of any route returns a ~12KB shell whose <body> has no
 * className and no markup — every page is a 'use client' component behind
 * `force-dynamic`, so React streams the whole tree through the flight payload
 * and nothing written into the layout's JSX (a <script> included) reaches the
 * initial HTML. An inline script there executes never.
 *
 * Running at module scope means this fires the moment the chunk is parsed —
 * before React renders a single element — which is the earliest hook available
 * given the above. The cost is that a light-mode visitor can see the dark page
 * background for the span of the bundle download, since CSS paints `:root`
 * (dark) before any JS runs. Content does not flash, because there is no
 * server-rendered content to flash. If this app ever gains real SSR, move this
 * back to a blocking inline script in the layout and delete this file.
 */
// Fires the moment this chunk is parsed — earlier than any React lifecycle.
if (typeof document !== 'undefined') {
  applyStoredTheme();
}

export default function ThemeScript() {
  // The module-level call above covers a cold load, but it runs exactly once per
  // chunk evaluation. React re-mounting the tree (and, in development, Strict
  // Mode's double render) can land with the attribute cleared, so re-assert it
  // before paint. useLayoutEffect is deliberate: useEffect would run after the
  // browser paints and reintroduce the flash this file exists to avoid.
  useLayoutEffect(() => {
    applyStoredTheme();
  }, []);
  return null;
}
