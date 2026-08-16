import { NextRequest, NextResponse } from 'next/server';

// This endpoint receives the OAuth callback and exchanges code for tokens
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');
  
  // Parse the state to get the mobile callback URL
  let mobileCallbackUrl = 'wagerpals://oauth-callback';
  
  if (stateParam) {
    try {
      const state = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
      if (state.callback_url) {
        mobileCallbackUrl = state.callback_url;
      }
    } catch (e) {
      console.error('Failed to parse state:', e);
    }
  }
  
  if (error) {
    const errorUrl = new URL(mobileCallbackUrl);
    errorUrl.searchParams.set('error', error);
    return NextResponse.redirect(errorUrl.toString());
  }
  
  if (!code) {
    const errorUrl = new URL(mobileCallbackUrl);
    errorUrl.searchParams.set('error', 'No authorization code received');
    return NextResponse.redirect(errorUrl.toString());
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
      const errorUrl = new URL(mobileCallbackUrl);
      errorUrl.searchParams.set('error', `Token exchange failed: ${errorData.substring(0, 200)}`);
      return NextResponse.redirect(errorUrl.toString());
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
    const successUrl = new URL(mobileCallbackUrl);
    successUrl.searchParams.set('access_token', tokens.access_token);
    if (tokens.refresh_token) {
      successUrl.searchParams.set('refresh_token', tokens.refresh_token);
    }
    if (userData.id) {
      successUrl.searchParams.set('user_id', userData.id);
    }
    if (userData.primary_email) {
      successUrl.searchParams.set('email', userData.primary_email);
    }
    if (userData.display_name) {
      successUrl.searchParams.set('display_name', userData.display_name);
    }
    
    return NextResponse.redirect(successUrl.toString());
  } catch (error) {
    console.error('OAuth callback error:', error);
    const errorUrl = new URL(mobileCallbackUrl);
    errorUrl.searchParams.set('error', 'Authentication failed');
    return NextResponse.redirect(errorUrl.toString());
  }
}




