import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// This endpoint initiates OAuth by redirecting straight to Stack Auth's
// authorize endpoint, which itself redirects on to the provider (Google).
//
// It used to instead make a server-side `fetch()` to that same authorize
// endpoint first, expecting a 301/302 (or a JSON `authorization_url`) to
// re-redirect to. That fetch never sent any of the query params Stack Auth's
// authorize endpoint actually requires (client_id, redirect_uri, scope,
// code_challenge, response_type, type, error_redirect_url — see
// node_modules/@stackframe/stack-shared's `getOAuthUrl`, which is what the
// Stack Auth React SDK itself sends), so it never got a real redirect back
// and *every* sign-in fell through to the "Fallback" branch: a redirect to
// the full web /auth/signin page — which has its own separate "Continue with
// Google" button — rendered inside the mobile app's in-app browser sheet.
// That's the "opens up a new webpage with 'continue with google'" the owner
// reported: tapping the button in the app always bounced through a second,
// unnecessary full webpage before the real Google flow even started.
//
// Building the fully-parameterized authorize URL here and redirecting to it
// directly skips that intermediate page. The OAuth contract itself is
// unchanged: redirect_uri is still
// `${appUrl}/api/auth/mobile-oauth-callback` (same route, same token
// exchange, same `code_verifier: 'none'`), and `state` still carries our
// base64url-encoded `{ callback_url }` payload, which Stack Auth echoes back
// unmodified on the callback exactly as before.
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const provider = searchParams.get('provider') || 'google';
  const callbackUrl = searchParams.get('callback_url') || 'wagerpals://oauth-callback';

  const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID || '';
  const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || '';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://wagerpals.io';

  // Our callback URL that Stack Auth will redirect to after OAuth — unchanged
  // from before, still consumed by mobile-oauth-callback/route.ts.
  const redirectUri = `${appUrl}/api/auth/mobile-oauth-callback`;

  // Store mobile callback in state (Stack Auth echoes `state` back unmodified
  // on the OAuth callback; mobile-oauth-callback decodes it to recover
  // callback_url) — same encoding as before.
  const state = Buffer.from(JSON.stringify({ callback_url: callbackUrl })).toString('base64url');

  // Web sign-in fallback URL, used only if we can't build the authorize URL
  // (e.g. missing Stack Auth env vars) or if Stack Auth itself reports an
  // error via `error_redirect_url` — not on the happy path anymore.
  const mobileCallback = Buffer.from(callbackUrl).toString('base64url');
  const signInFallbackUrl = new URL(`${appUrl}/auth/signin`);
  signInFallbackUrl.searchParams.set('mobile_callback', mobileCallback);

  try {
    if (!projectId || !publishableKey) {
      return NextResponse.redirect(signInFallbackUrl.toString());
    }

    // mobile-oauth-callback exchanges the authorization code with a
    // hardcoded `code_verifier: 'none'` (this flow holds no real per-request
    // PKCE secret server-side) — the code_challenge sent here must be the
    // S256 hash of that same literal string so the two ends of the PKCE
    // handshake agree. This mirrors the existing token-exchange code
    // exactly; it does not change it.
    const codeChallenge = crypto.createHash('sha256').update('none').digest('base64url');

    const authorizeUrl = new URL(`https://api.stack-auth.com/api/v1/auth/oauth/authorize/${provider}`);
    authorizeUrl.searchParams.set('client_id', projectId);
    authorizeUrl.searchParams.set('client_secret', publishableKey);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', 'legacy');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('grant_type', 'authorization_code');
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('type', 'authenticate');
    authorizeUrl.searchParams.set('error_redirect_url', signInFallbackUrl.toString());

    return NextResponse.redirect(authorizeUrl.toString());
  } catch (error) {
    console.error('OAuth init error:', error);
    return NextResponse.redirect(signInFallbackUrl.toString());
  }
}




