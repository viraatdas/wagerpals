import { NextRequest, NextResponse } from 'next/server';
import { getAllowedAuthCallbackUrl } from '@/lib/auth-redirect';

const DEFAULT_MOBILE_CALLBACK = 'wagerpals://oauth-callback';

// This endpoint receives the OAuth callback and exchanges code for tokens
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');

  // Parse the state to get the requested mobile callback URL. `state` is
  // attacker-controllable (it's just base64 the client sent us and we
  // reflect back), so the callback URL it contains MUST be validated
  // against an allowlist before we ever attach tokens to it or redirect —
  // see lib/auth-redirect.ts. Fail closed on any parse/validation failure.
  let requestedCallback: string = DEFAULT_MOBILE_CALLBACK;
  if (stateParam) {
    try {
      const state = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
      if (typeof state.callback_url === 'string') {
        requestedCallback = state.callback_url;
      }
    } catch (e) {
      console.error('Failed to parse state:', e);
    }
  }

  const callbackUrl = getAllowedAuthCallbackUrl(requestedCallback);
  if (!callbackUrl) {
    console.error('Rejected OAuth callback redirect to disallowed URL:', requestedCallback);
    return NextResponse.json({ error: 'Invalid or disallowed callback URL' }, { status: 400 });
  }

  if (error) {
    callbackUrl.searchParams.set('error', error);
    return NextResponse.redirect(callbackUrl.toString());
  }

  if (!code) {
    callbackUrl.searchParams.set('error', 'No authorization code received');
    return NextResponse.redirect(callbackUrl.toString());
  }

  try {
    const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID || '';
    const secretKey = process.env.STACK_SECRET_SERVER_KEY || '';
    const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || '';
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'https://wagerpals.io'}/api/auth/mobile-oauth-callback`;

    // Exchange the code for tokens using Stack Auth API
    const tokenResponse = await fetch('https://api.stack-auth.com/api/v1/auth/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-stack-project-id': projectId,
        'x-stack-secret-server-key': secretKey,
        'x-stack-publishable-client-key': publishableKey,
        'x-stack-access-type': 'server',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: 'none',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', errorData);
      callbackUrl.searchParams.set('error', `Token exchange failed: ${errorData.substring(0, 200)}`);
      return NextResponse.redirect(callbackUrl.toString());
    }

    const tokens = await tokenResponse.json();

    // Get user info
    const userResponse = await fetch('https://api.stack-auth.com/api/v1/users/me', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'x-stack-project-id': projectId,
        'x-stack-publishable-client-key': publishableKey,
        'x-stack-access-type': 'client',
      },
    });

    let userData: any = {};
    if (userResponse.ok) {
      userData = await userResponse.json();
    }

    // Redirect to mobile app with tokens and user data
    callbackUrl.searchParams.set('access_token', tokens.access_token);
    if (tokens.refresh_token) {
      callbackUrl.searchParams.set('refresh_token', tokens.refresh_token);
    }
    if (userData.id) {
      callbackUrl.searchParams.set('user_id', userData.id);
    }
    if (userData.primary_email) {
      callbackUrl.searchParams.set('email', userData.primary_email);
    }
    if (userData.display_name) {
      callbackUrl.searchParams.set('display_name', userData.display_name);
    }

    return NextResponse.redirect(callbackUrl.toString());
  } catch (error) {
    console.error('OAuth callback error:', error);
    callbackUrl.searchParams.set('error', 'Authentication failed');
    return NextResponse.redirect(callbackUrl.toString());
  }
}
