import { NextRequest, NextResponse } from 'next/server';
import { stackServerApp } from '@/lib/stack';
import { getAllowedAuthCallbackUrl } from '@/lib/auth-redirect';

const DEFAULT_MOBILE_CALLBACK = 'wagerpals://oauth-callback';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const callbackParam = searchParams.get('callback');

  // Decode the requested mobile callback URL. `callback` is attacker
  // controllable (it's an opaque query param we base64-decode and reflect
  // back), so it MUST be validated against an allowlist before we ever
  // attach tokens to it or redirect — see lib/auth-redirect.ts. Fail closed
  // on any decode/validation failure.
  let requestedCallback: string = DEFAULT_MOBILE_CALLBACK;
  if (callbackParam) {
    try {
      requestedCallback = Buffer.from(callbackParam, 'base64url').toString();
    } catch (e) {
      console.error('Failed to decode callback:', e);
    }
  }

  const callbackUrl = getAllowedAuthCallbackUrl(requestedCallback);
  if (!callbackUrl) {
    console.error('Rejected mobile-session redirect to disallowed URL:', requestedCallback);
    return NextResponse.json({ error: 'Invalid or disallowed callback URL' }, { status: 400 });
  }

  try {
    // Get the current user from the session
    const user = await stackServerApp.getUser();

    if (!user) {
      callbackUrl.searchParams.set('error', 'Not authenticated');
      return NextResponse.redirect(callbackUrl.toString());
    }

    // Get the real session tokens from the Stack SDK, NOT by grepping cookies.
    // Stack keeps the access token in memory (only the refresh token is ever a
    // cookie), and it rebranded its infra to "hexclave", so the old
    // cookie.name.includes('stack-access') scan returned an EMPTY access token
    // — the app then threw "No access token received" and the OAuth round-trip
    // appeared to hang/never complete. currentSession.getTokens() is the
    // supported, rebrand-proof accessor.
    let accessToken = '';
    let refreshToken = '';
    try {
      const tokens = await user.currentSession.getTokens();
      accessToken = tokens.accessToken ?? '';
      refreshToken = tokens.refreshToken ?? '';
    } catch (e) {
      console.error('mobile-session: getTokens failed', e);
    }

    const userId = user.id;
    const email = user.primaryEmail || '';
    const displayName = user.displayName || email.split('@')[0] || 'User';

    // Redirect to mobile app with session data
    if (accessToken) {
      callbackUrl.searchParams.set('access_token', accessToken);
    }
    if (refreshToken) {
      callbackUrl.searchParams.set('refresh_token', refreshToken);
    }
    callbackUrl.searchParams.set('user_id', userId);
    callbackUrl.searchParams.set('email', email);
    callbackUrl.searchParams.set('display_name', displayName);

    return NextResponse.redirect(callbackUrl.toString());
  } catch (error) {
    console.error('Mobile session error:', error);
    callbackUrl.searchParams.set('error', 'Failed to get session');
    return NextResponse.redirect(callbackUrl.toString());
  }
}
