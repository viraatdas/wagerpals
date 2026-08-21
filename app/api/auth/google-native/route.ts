import { NextRequest, NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { stackServerApp } from '@/lib/stack';
import { syncUser } from '@/lib/sync-user';
import type { AuthenticatedStackUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Native Google Sign-In exchange endpoint.
//
// The iOS app runs Google's native account picker (no in-app browser, no
// "hexclave" consent screen, no captcha) and hands us the Google ID token.
// This endpoint verifies that token against Google directly, turns it into a
// Stack Auth session (the app's canonical backend identity), and returns the
// same { access_token, refresh_token, ... } shape the email/magic-link path
// returns, so nothing downstream has to change.
//
// SECURITY (CLAUDE.md §8, "Single canonical user sync"): the ONLY thing we
// trust here is the Google ID token, and only AFTER OAuth2Client has
// cryptographically verified it (signature, expiry, issuer, and audience).
// Every identity field below (email, name, picture, sub) is read from that
// verified payload — never from any other part of the request body. The
// resulting `users` row is created/refreshed through the same syncUser() the
// web path uses, so one human still maps to exactly one row.

// Public OAuth client IDs (not secrets) used only as the accepted `audience`
// of the ID token. GOOGLE_WEB_CLIENT_ID is the existing Web OAuth client
// (1084366774946-...); GOOGLE_IOS_CLIENT_ID is the iOS client the app is
// configured with. A token minted for either is accepted.
const WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID || '';
const IOS_CLIENT_ID = process.env.GOOGLE_IOS_CLIENT_ID || '';

// One reusable verifier. No client id is passed to the constructor because we
// pass the accepted audience explicitly to verifyIdToken below.
const googleClient = new OAuth2Client();

export async function POST(request: NextRequest) {
  let idToken: unknown;
  try {
    const body = await request.json();
    idToken = body?.idToken;
  } catch {
    return NextResponse.json({ error: 'We could not read your sign-in request. Please try again.' }, { status: 400 });
  }

  if (!idToken || typeof idToken !== 'string') {
    return NextResponse.json({ error: 'Missing Google identity token.' }, { status: 400 });
  }

  const audience = [WEB_CLIENT_ID, IOS_CLIENT_ID].filter(Boolean);
  if (audience.length === 0) {
    console.error('[google-native] GOOGLE_WEB_CLIENT_ID / GOOGLE_IOS_CLIENT_ID are not set; refusing to verify.');
    return NextResponse.json({ error: 'Google sign-in is not available right now. Please try another sign-in method.' }, { status: 500 });
  }

  // Verify the token against Google. This is the identity check — a failure
  // here means the token is forged, expired, or minted for a different app.
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch (err) {
    console.error('[google-native] ID token verification failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'We could not verify your Google sign-in. Please try again.' }, { status: 401 });
  }

  if (!payload || !payload.email || payload.email_verified !== true) {
    return NextResponse.json(
      { error: 'Your Google account email is not verified, so we could not sign you in.' },
      { status: 401 }
    );
  }

  const email = payload.email.trim().toLowerCase();
  const name = payload.name?.trim() || null;
  const picture = payload.picture || null;

  try {
    // Reuse an existing Stack user for this email if one exists (so a person
    // who signed in on the web with Google keeps the same account), otherwise
    // create one. listUsers({ query }) searches; match the exact primary email.
    const candidates = await stackServerApp.listUsers({ query: email, limit: 100 });
    let stackUser = candidates.find((u) => (u.primaryEmail || '').toLowerCase() === email) || null;

    if (!stackUser) {
      stackUser = await stackServerApp.createUser({
        primaryEmail: email,
        primaryEmailAuthEnabled: true,
        primaryEmailVerified: true,
        displayName: name || undefined,
      });
    }

    // Mint a real Stack session for this user, exactly like the web OAuth
    // return leg does (mobile-session getTokens()).
    const session = await stackUser.createSession();
    const tokens = await session.getTokens();
    if (!tokens.accessToken) {
      console.error('[google-native] createSession returned no access token for user', stackUser.id);
      return NextResponse.json({ error: 'Something went wrong signing you in. Please try again.' }, { status: 500 });
    }

    // Build the same AuthenticatedStackUser shape lib/auth.ts produces, from
    // the VERIFIED Google payload plus the resolved Stack user, and funnel it
    // through the one canonical sync path. `google` is recorded as the auth
    // method because the human proved it by signing in with a Google token we
    // verified.
    const authUser: AuthenticatedStackUser = {
      id: stackUser.id,
      primaryEmail: email,
      primaryEmailVerified: true,
      displayName: name ?? stackUser.displayName ?? null,
      profileImageUrl: picture ?? stackUser.profileImageUrl ?? null,
      hasPassword: !!stackUser.hasPassword,
      otpAuthEnabled: !!stackUser.otpAuthEnabled,
      passkeyAuthEnabled: !!stackUser.passkeyAuthEnabled,
      oauthProviderIds: ['google'],
    };

    const result = await syncUser(authUser);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken ?? '',
      user_id: result.user.id,
      email: result.user.email ?? email,
      display_name: result.user.display_name ?? name ?? email.split('@')[0],
    });
  } catch (err) {
    console.error('[google-native] Failed to mint session:', err);
    return NextResponse.json({ error: 'Something went wrong signing you in. Please try again.' }, { status: 500 });
  }
}
