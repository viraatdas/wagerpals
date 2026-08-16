import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { email, code } = await request.json();

    if (!email || !code) {
      return NextResponse.json(
        { error: 'Email and code are required' },
        { status: 400 }
      );
    }

    const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID || '';
    const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || '';

    // Verify OTP code with Stack Auth
    const response = await fetch('https://api.stack-auth.com/api/v1/auth/otp/sign-in', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-stack-project-id': projectId,
        'x-stack-publishable-client-key': publishableKey,
        'x-stack-access-type': 'client',
      },
      body: JSON.stringify({ email, code }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Stack Auth verify code error:', errorData);
      return NextResponse.json(
        { error: 'Invalid verification code' },
        { status: 401 }
      );
    }

    const data = await response.json();

    // Get user info with the access token
    let userData: any = {};
    if (data.access_token) {
      const userResponse = await fetch('https://api.stack-auth.com/api/v1/users/me', {
        headers: {
          'Authorization': `Bearer ${data.access_token}`,
          'x-stack-project-id': projectId,
          'x-stack-publishable-client-key': publishableKey,
          'x-stack-access-type': 'client',
        },
      });

      if (userResponse.ok) {
        userData = await userResponse.json();
      }
    }

    return NextResponse.json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user_id: userData.id || '',
      email: userData.primary_email || email,
      display_name: userData.display_name || email.split('@')[0],
    });
  } catch (error) {
    console.error('Verify code error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
