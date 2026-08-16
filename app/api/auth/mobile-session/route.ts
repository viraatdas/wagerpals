import { NextRequest, NextResponse } from 'next/server';
import { stackServerApp } from '@/lib/stack';
import { cookies } from 'next/headers';
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

    // Try to get the access token from cookies
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();

    // Look for Stack Auth session cookies
    let accessToken = '';
    let refreshToken = '';

    for (const cookie of allCookies) {
      if (cookie.name.includes('stack-access') || cookie.name.includes('accessToken')) {
        accessToken = cookie.value;
      }
      if (cookie.name.includes('stack-refresh') || cookie.name.includes('refreshToken')) {
        refreshToken = cookie.value;
      }
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
