import 'server-only';
import { timingSafeEqual } from 'crypto';
import { stackServerApp, MOBILE_SESSION_EXPIRES_IN_MS } from '@/lib/stack';
import { syncUser } from '@/lib/sync-user';
import type { AuthenticatedStackUser } from '@/lib/auth';

// App Review demonstration mode (Guideline 2.1(a), "Information Needed").
//
// WHY THIS EXISTS: the iOS app offers exactly three ways in — an emailed
// 6-character code, Google, and Apple. There is no password field anywhere in
// `mobile/src/screens/AuthScreen.tsx`, so the username/password pair sitting in
// App Store Connect's App Review Information section is unusable: a reviewer
// has no box to type it into and no access to the inbox the code is mailed to.
// That is what got build 23 rejected. Apple's own remedy is quoted in the
// rejection: "It is also acceptable to include a demonstration mode that
// exhibits the app's full features and functionality."
//
// WHAT IT IS: for ONE configured email address, one configured code is accepted
// in place of the emailed one. Nothing else changes — the reviewer signs in as
// an ordinary user and every downstream permission, money and notification path
// behaves exactly as it does for anyone else. This is not a privileged account
// and grants no elevated access.
//
// SECURITY INVARIANTS (CLAUDE.md §8, "Single canonical user sync"):
//   - Inert unless BOTH env vars are set. No default email, no default code, no
//     fallback. An unconfigured deployment has no bypass at all.
//   - The code must be at least 6 characters. It cannot be longer: the app's
//     code field strips non-digits and caps at CODE_LENGTH = 6
//     (`mobile/src/screens/AuthScreen.tsx`), so a longer or alphanumeric code
//     would be physically untypeable by the reviewer. Six digits is only
//     10^6, so the CODE IS NOT THE SECRET — the address is. Configure
//     APP_REVIEW_DEMO_EMAIL to something unguessable, never a predictable
//     name like appreview@ or review@, because an attacker must guess both and
//     the address is the half with real entropy.
//   - It matches ONE email. Every other address goes through Stack Auth's real
//     OTP exchange untouched.
//   - Comparison is constant-time on both fields, so neither the address nor
//     the code can be recovered by timing.
//   - The session is minted through `stackServerApp` and the row through
//     `syncUser()`, the same canonical path every other sign-in uses. No
//     hand-rolled identity, no forged header.
//   - Every acceptance is logged.
//
// OPERATIONAL NOTE: unset APP_REVIEW_DEMO_CODE once the app is approved and the
// bypass disappears with it. Rotate it between submissions.

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  // Compare fixed-width digests of equal size instead by padding to the longer.
  const len = Math.max(ab.length, bb.length);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ab.copy(pa);
  bb.copy(pb);
  // Still fold in the real lengths so "abc" and "abc\0" are not equal.
  return timingSafeEqual(pa, pb) && ab.length === bb.length;
}

const MIN_CODE_LENGTH = 6;

function config(): { email: string; code: string } | null {
  const email = (process.env.APP_REVIEW_DEMO_EMAIL || '').trim().toLowerCase();
  const code = (process.env.APP_REVIEW_DEMO_CODE || '').trim();
  if (!email || !email.includes('@')) return null;
  if (code.length < MIN_CODE_LENGTH) return null;
  return { email, code };
}

/** True when this address is the configured review address. */
export function isReviewDemoEmail(email: unknown): boolean {
  const cfg = config();
  if (!cfg || typeof email !== 'string') return false;
  return constantTimeEquals(email.trim().toLowerCase(), cfg.email);
}

/** True when this address AND code are both the configured review pair. */
export function isReviewDemoLogin(email: unknown, code: unknown): boolean {
  const cfg = config();
  if (!cfg || typeof email !== 'string' || typeof code !== 'string') return false;
  return (
    constantTimeEquals(email.trim().toLowerCase(), cfg.email) &&
    constantTimeEquals(code.trim(), cfg.code)
  );
}

export type ReviewDemoSession = {
  access_token: string;
  refresh_token: string;
  user_id: string;
  email: string;
  display_name: string;
};

/**
 * Mint a real session for the review account, through the same Stack Auth +
 * syncUser path every other sign-in uses. Returns null if demo mode is off.
 */
export async function mintReviewDemoSession(): Promise<
  { ok: true; session: ReviewDemoSession } | { ok: false; status: number; error: string } | null
> {
  const cfg = config();
  if (!cfg) return null;

  const email = cfg.email;

  const candidates = await stackServerApp.listUsers({ query: email, limit: 100 });
  let stackUser = candidates.find((u) => (u.primaryEmail || '').toLowerCase() === email) || null;

  if (!stackUser) {
    stackUser = await stackServerApp.createUser({
      primaryEmail: email,
      primaryEmailAuthEnabled: true,
      primaryEmailVerified: true,
      displayName: 'App Review',
    });
  }

  const session = await stackUser.createSession({ expiresInMillis: MOBILE_SESSION_EXPIRES_IN_MS });
  const tokens = await session.getTokens();
  if (!tokens.accessToken) {
    console.error('[app-review-demo] createSession returned no access token for', stackUser.id);
    return { ok: false, status: 500, error: 'Sign-in is unavailable right now' };
  }

  const authUser: AuthenticatedStackUser = {
    id: stackUser.id,
    primaryEmail: email,
    primaryEmailVerified: true,
    displayName: stackUser.displayName ?? 'App Review',
    profileImageUrl: stackUser.profileImageUrl ?? null,
    hasPassword: !!stackUser.hasPassword,
    otpAuthEnabled: !!stackUser.otpAuthEnabled,
    passkeyAuthEnabled: !!stackUser.passkeyAuthEnabled,
    oauthProviderIds: [],
  };

  const result = await syncUser(authUser);
  if (!result.ok) return { ok: false, status: result.status, error: result.error };

  console.warn('[app-review-demo] demonstration-mode sign-in accepted for the review account');

  return {
    ok: true,
    session: {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken ?? '',
      user_id: result.user.id,
      email: result.user.email ?? email,
      display_name: result.user.display_name ?? 'App Review',
    },
  };
}
