import { NextRequest, NextResponse } from 'next/server';

// This endpoint initiates OAuth by calling Stack Auth's API with proper headers
// then redirects to the returned authorization URL
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const provider = searchParams.get('provider') || 'google';
  const callbackUrl = searchParams.get('callback_url') || 'wagerpals://oauth-callback';
  
  const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID || '';
  const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || '';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://wagerpals.io';
  
  // Our callback URL that Stack Auth will redirect to after OAuth
  const redirectUri = `${appUrl}/api/auth/mobile-oauth-callback`;
  
  // Store mobile callback in state
  const state = Buffer.from(JSON.stringify({ callback_url: callbackUrl })).toString('base64url');

  try {
    // Call Stack Auth API to get the OAuth authorization URL
    const response = await fetch(`https://api.stack-auth.com/api/v1/auth/oauth/authorize/${provider}`, {
      method: 'GET',
      headers: {
        'X-Stack-Access-Type': 'client',
        'X-Stack-Project-Id': projectId,
        'X-Stack-Publishable-Client-Key': publishableKey,
      },
    });

    // If Stack Auth returns a redirect, follow it
    if (response.status === 302 || response.status === 301) {
      const location = response.headers.get('location');
      if (location) {
        // Add our state and redirect_uri to the OAuth URL
        const oauthUrl = new URL(location);
        oauthUrl.searchParams.set('state', state);
        oauthUrl.searchParams.set('redirect_uri', redirectUri);
        return NextResponse.redirect(oauthUrl.toString());
      }
    }

    // If we get JSON response with authorization URL
    if (response.ok) {
      const data = await response.json();
      if (data.authorization_url) {
        const oauthUrl = new URL(data.authorization_url);
        oauthUrl.searchParams.set('state', state);
        return NextResponse.redirect(oauthUrl.toString());
      }
    }

    // Fallback: redirect to web sign-in page
    const mobileCallback = Buffer.from(callbackUrl).toString('base64url');
    const signInUrl = new URL(`${appUrl}/auth/signin`);
    signInUrl.searchParams.set('mobile_callback', mobileCallback);
    return NextResponse.redirect(signInUrl.toString());
    
  } catch (error) {
    console.error('OAuth init error:', error);
    // Fallback to web sign-in
    const mobileCallback = Buffer.from(callbackUrl).toString('base64url');
    const signInUrl = new URL(`${appUrl}/auth/signin`);
    signInUrl.searchParams.set('mobile_callback', mobileCallback);
    return NextResponse.redirect(signInUrl.toString());
  }
}




