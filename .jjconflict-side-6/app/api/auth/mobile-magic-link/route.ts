import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID || '';
    const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || '';
    const secretKey = process.env.STACK_SECRET_SERVER_KEY || '';

    // Use Stack Auth's OTP (magic code) sign-in endpoint
    const response = await fetch('https://api.stack-auth.com/api/v1/auth/otp/sign-in', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-stack-project-id': projectId,
        'x-stack-publishable-client-key': publishableKey,
        'x-stack-access-type': 'client',
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Stack Auth magic link error:', errorData);
      return NextResponse.json(
        { error: 'Failed to send verification code' },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Magic link error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
