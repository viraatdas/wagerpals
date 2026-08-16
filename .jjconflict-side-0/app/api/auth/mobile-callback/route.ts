import { NextRequest, NextResponse } from 'next/server';
import { stackServerApp } from '@/lib/stack';

export async function POST(request: NextRequest) {
  try {
    const { code, redirect_uri } = await request.json();

    if (!code) {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
    }

    // Exchange the authorization code for tokens using Stack Auth
    // This is a simplified version - you may need to adjust based on Stack Auth's mobile docs
    const tokenResponse = await fetch('https://api.stack-auth.com/api/v1/auth/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-stack-project-id': process.env.NEXT_PUBLIC_STACK_PROJECT_ID || '',
        'x-stack-secret-server-key': process.env.STACK_SECRET_SERVER_KEY || '',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri,
      }),
    });

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', await tokenResponse.text());
      return NextResponse.json({ error: 'Failed to exchange code for token' }, { status: 400 });
    }

    const tokens = await tokenResponse.json();

    // Get user info from Stack Auth
    const userResponse = await fetch('https://api.stack-auth.com/api/v1/users/me', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'x-stack-project-id': process.env.NEXT_PUBLIC_STACK_PROJECT_ID || '',
      },
    });

    if (!userResponse.ok) {
      return NextResponse.json({ error: 'Failed to get user info' }, { status: 400 });
    }

    const userData = await userResponse.json();

    // Return user data to mobile app
    return NextResponse.json({
      id: userData.id,
      email: userData.primary_email,
      displayName: userData.display_name,
      primaryEmail: userData.primary_email,
    });
  } catch (error) {
    console.error('Mobile OAuth callback error:', error);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}




