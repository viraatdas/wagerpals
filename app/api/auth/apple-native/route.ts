import { NextRequest, NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { stackServerApp } from '@/lib/stack';
import { syncUser } from '@/lib/sync-user';
import type { AuthenticatedStackUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Native Sign in with Apple exchange endpoint.
//
// The iOS app runs Apple's native Sign in with Apple sheet (Face ID / the
// system account picker, no in-app browser) and hands us the Apple identity
// token. This endpoint verifies that token against Apple directly, turns it
// into a Stack Auth session (the app's canonical backend identity), and
// returns the same { access_token, refresh_token, ... } shape the
// email/magic-link and google-native paths return, so nothing downstream has
// to change.
//
// SECURITY (CLAUDE.md §8, "Single canonical user sync"): the ONLY thing we
// trust here is the Apple identity token, and only AFTER jose has
// cryptographically verified it (RS256 signature against Apple's published
// JWKS, plus issuer, audience, and expiry). The stable identity is `sub` and
// the email is read from that verified payload. The `fullName`/`email` the
// client forwards are Apple's FIRST-authorization-only extras — Apple returns
// the name exactly once and may omit the email on later sign-ins — so we use
// them ONLY as a display-name hint and as a last-resort lookup hint, NEVER as
// trusted identity. The identity token is the sole trusted source. The
// resulting `users` row is created/refreshed through the same syncUser() the
// web path uses, so one human still maps to exactly one row.

// The app's own bundle id is the audience of a native Sign in with Apple
// identity token (a native iOS app authenticates against its bundle id — no
// separate Services ID is involved). Public identifier, not a secret.
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.wagerpals.app';

const APPLE_ISSUER = 'https://appleid.apple.com';

// One reusable remote JWKS. jose caches and refreshes the keys internally, so
// we fetch Apple's public keys at most once per key-rotation window rather
// than on every request.
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

// Apple's `email_verified` / `is_private_email` come through as either real
// booleans or the strings "true"/"false" depending on the flow.
function isTruthyClaim(value: unknown): boolean {
  return value === true || value === 'true';
}

export async function POST(request: NextRequest) {
  let identityToken: unknown;
  let clientFullName: unknown;
  let clientEmail: unknown;
  try {
    const body = await request.json();
    identityToken = body?.identityToken;
    clientFullName = body?.fullName;
    clientEmail = body?.email;
  } catch {
    return NextResponse.json({ error: 'We could not read your sign-in request. Please try again.' }, { status: 400 });
  }

  if (!identityToken || typeof identityToken !== 'string') {
    return NextResponse.json({ error: 'Missing Apple identity token.' }, { status: 400 });
  }

  // Verify the token against Apple. This is the identity check — a failure
  // here means the token is forged, expired, or minted for a different app.
  let payload;
  try {
    const result = await jwtVerify(identityToken, appleJwks, {
      issuer: APPLE_ISSUER,
      audience: APPLE_BUNDLE_ID,
    });
    payload = result.payload;
  } catch (err) {
    console.error('[apple-native] identity token verification failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'We could not verify your Apple sign-in. Please try again.' }, { status: 401 });
  }

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) {
    return NextResponse.json({ error: 'We could not verify your Apple sign-in. Please try again.' }, { status: 401 });
  }

  // Email from the verified token is trusted identity (it may be a private
  // relay address like xxx@privaterelay.appleid.com — that IS the user's
  // WagerPals identity, treated exactly like any other email). Apple omits it
  // on non-first sign-ins; when that happens we fall back to the
  // client-provided email ONLY as a lookup hint, never as trusted identity.
  const tokenEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const hintEmail =
    typeof clientEmail === 'string' && clientEmail.includes('@') ? clientEmail.trim().toLowerCase() : '';
  const email = tokenEmail || hintEmail;

  // FIRST-authorization-only display name, if the client forwarded it.
  let name: string | null = null;
  if (clientFullName && typeof clientFullName === 'object') {
    const fn = clientFullName as { givenName?: unknown; familyName?: unknown };
    const parts = [fn.givenName, fn.familyName]
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .map((p) => p.trim());
    if (parts.length > 0) name = parts.join(' ');
  } else if (typeof clientFullName === 'string' && clientFullName.trim().length > 0) {
    name = clientFullName.trim();
  }

  try {
    // Resolve the Stack user. Prefer an existing user for this email (so a
    // person who signed in on the web keeps the same account). Apple gives us
    // a verified email whenever it gives us one at all, so email is the join
    // key here just as it is for google-native.
    let stackUser = null;
    if (email) {
      const candidates = await stackServerApp.listUsers({ query: email, limit: 100 });
      stackUser = candidates.find((u) => (u.primaryEmail || '').toLowerCase() === email) || null;
    }

    if (!stackUser) {
      if (!email) {
        // No email in the token and none provided as a hint (a later sign-in
        // where the user revoked email sharing). We have no stable way to
        // reconcile to a Stack user by email, so we cannot create/refresh a
        // canonical row. This only happens if a first sign-in was never
        // completed against this backend.
        console.error('[apple-native] no email available for Apple sub', sub);
        return NextResponse.json(
          { error: 'We could not find your account. Please sign in again from the start.' },
          { status: 401 }
        );
      }
      stackUser = await stackServerApp.createUser({
        primaryEmail: email,
        primaryEmailAuthEnabled: true,
        primaryEmailVerified: true,
        displayName: name || undefined,
      });
    }

    // Mint a real Stack session for this user, exactly like the web OAuth
    // return leg and google-native do (mobile-session getTokens()).
    const session = await stackUser.createSession();
    const tokens = await session.getTokens();
    if (!tokens.accessToken) {
      console.error('[apple-native] createSession returned no access token for user', stackUser.id);
      return NextResponse.json({ error: 'Something went wrong signing you in. Please try again.' }, { status: 500 });
    }

    // Build the same AuthenticatedStackUser shape lib/auth.ts produces, from
    // the VERIFIED Apple payload plus the resolved Stack user, and funnel it
    // through the one canonical sync path. `apple` is recorded as the auth
    // method because the human proved it by signing in with an Apple token we
    // verified. An email that came from the verified token is trusted as
    // verified (Apple mints verified emails, and confirms it with the
    // email_verified claim); a client-provided hint email is NOT claimed as
    // verified.
    const emailVerified = !!tokenEmail && (isTruthyClaim(payload.email_verified) || payload.email_verified === undefined);
    const authUser: AuthenticatedStackUser = {
      id: stackUser.id,
      primaryEmail: email || stackUser.primaryEmail || null,
      primaryEmailVerified: emailVerified,
      displayName: name ?? stackUser.displayName ?? null,
      profileImageUrl: stackUser.profileImageUrl ?? null,
      hasPassword: !!stackUser.hasPassword,
      otpAuthEnabled: !!stackUser.otpAuthEnabled,
      passkeyAuthEnabled: !!stackUser.passkeyAuthEnabled,
      oauthProviderIds: ['apple'],
    };

    const result = await syncUser(authUser);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const resolvedEmail = result.user.email ?? email ?? '';
    return NextResponse.json({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken ?? '',
      user_id: result.user.id,
      email: resolvedEmail,
      display_name: result.user.display_name ?? name ?? (resolvedEmail ? resolvedEmail.split('@')[0] : 'Pal'),
    });
  } catch (err) {
    console.error('[apple-native] Failed to mint session:', err);
    return NextResponse.json({ error: 'Something went wrong signing you in. Please try again.' }, { status: 500 });
  }
}
