import { NextRequest, NextResponse } from 'next/server';
import { stackServerApp } from '@/lib/stack';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const callbackParam = searchParams.get('callback');
  
  // Decode the mobile callback URL
  let mobileCallbackUrl = 'wagerpals://oauth-callback';
  if (callbackParam) {
    try {
      mobileCallbackUrl = Buffer.from(callbackParam, 'base64url').toString();
    } catch (e) {
      console.error('Failed to decode callback:', e);
    }
  }
  
  try {
    // Get the current user from the session
    const user = await stackServerApp.getUser();
    
    if (!user) {
      const errorUrl = new URL(mobileCallbackUrl);
      errorUrl.searchParams.set('error', 'Not authenticated');
      return NextResponse.redirect(errorUrl.toString());
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
    const successUrl = new URL(mobileCallbackUrl);
    if (accessToken) {
      successUrl.searchParams.set('access_token', accessToken);
    }
    if (refreshToken) {
      successUrl.searchParams.set('refresh_token', refreshToken);
    }
    successUrl.searchParams.set('user_id', userId);
    successUrl.searchParams.set('email', email);
    successUrl.searchParams.set('display_name', displayName);
    
    return NextResponse.redirect(successUrl.toString());
  } catch (error) {
    console.error('Mobile session error:', error);
    const errorUrl = new URL(mobileCallbackUrl);
    errorUrl.searchParams.set('error', 'Failed to get session');
    return NextResponse.redirect(errorUrl.toString());
  }
}




