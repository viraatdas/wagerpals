// Shared allowlist for mobile/web OAuth "callback" redirect targets.
//
// Both app/api/auth/mobile-oauth-callback/route.ts and
// app/api/auth/mobile-session/route.ts accept an attacker-controllable
// callback URL (round-tripped through the OAuth `state` param or a
// `callback` query param) and, on success, redirect the browser to it with
// live access/refresh tokens attached as query params. If that URL were not
// tightly restricted, a crafted `state`/`callback` value could exfiltrate a
// real user's tokens to an attacker-controlled origin (open redirect ->
// token leak).
//
// This helper is the single source of truth for what counts as a safe
// redirect target. Both routes MUST validate the callback URL through this
// function BEFORE constructing any URL that tokens get appended to, and
// MUST fail closed (reject, no redirect, no tokens) if validation fails.

const MOBILE_APP_PROTOCOL = 'wagerpals:';

function getAllowedWebOrigin(): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return null;
  try {
    return new URL(appUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Validates a candidate OAuth callback URL against a strict allowlist.
 *
 * Allowed:
 *  - the app's own custom URL scheme, `wagerpals://...` (see the "scheme"
 *    field in mobile/app.json and the literal callback used by
 *    mobile/src/services/auth.ts: `wagerpals://oauth-callback`).
 *  - the app's own origin, `NEXT_PUBLIC_APP_URL`, matched EXACTLY
 *    (protocol + host + port) — not by prefix/substring.
 *
 * Everything else (including lookalike hosts such as
 * `https://wagerpals.io.attacker.example`, unregistered schemes like
 * `javascript:`, and unparseable strings) is rejected.
 *
 * Returns the parsed URL on success, or null if the candidate must be
 * rejected. Callers must treat a null return as "do not redirect, do not
 * attach tokens" — fail closed.
 */
export function getAllowedAuthCallbackUrl(candidate: string | null | undefined): URL | null {
  if (!candidate) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol === MOBILE_APP_PROTOCOL) {
    return parsed;
  }

  const allowedOrigin = getAllowedWebOrigin();
  if (
    allowedOrigin !== null &&
    (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
    parsed.origin === allowedOrigin
  ) {
    return parsed;
  }

  return null;
}
