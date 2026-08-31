import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Step 1 of email (OTP) sign-in for the mobile app: send the 6-character code.
//
// This route used to POST `{ email }` to Stack Auth's `/auth/otp/sign-in`,
// which is the WRONG endpoint and has not accepted an `email` field for some
// time. Stack Auth answers that request with
//
//   SCHEMA_ERROR: body.code must be defined; body contains unknown
//   properties: email
//
// which this route turned into a generic 400 "Failed to send verification
// code" — so email sign-in from the iOS app was dead, and the error message
// gave no hint why. Sending the code is `/auth/otp/send-sign-in-code`;
// `/auth/otp/sign-in` is step 2 and takes only a `code`.
//
// `send-sign-in-code` returns a `nonce`, and step 2's `code` must be the
// emailed code CONCATENATED with that nonce (the combined value has to be
// exactly 45 characters). The installed app posts `{ email }` here and
// `{ email, code }` to mobile-verify-code — it never sees a nonce — so we
// persist the nonce server-side, keyed by email, for verify to pick up. It
// cannot be kept in module memory: the two requests may land on different
// serverless instances.
//
// The nonce is also returned in the response so a future app build can pass
// it back explicitly; mobile-verify-code prefers a client-supplied nonce and
// falls back to the stored one. Old and new clients both work.
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID || '';
    const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || '';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.wagerpals.io';

    if (!projectId || !publishableKey) {
      console.error('[mobile-magic-link] Stack Auth env vars are missing');
      return NextResponse.json({ error: 'Sign-in is unavailable right now' }, { status: 500 });
    }

    const response = await fetch('https://api.stack-auth.com/api/v1/auth/otp/send-sign-in-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-stack-project-id': projectId,
        'x-stack-publishable-client-key': publishableKey,
        'x-stack-access-type': 'client',
      },
      body: JSON.stringify({
        email,
        callback_url: `${appUrl}/handler/magic-link-callback`,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[mobile-magic-link] Stack Auth send-sign-in-code failed:', response.status, errorData);
      return NextResponse.json(
        { error: 'Failed to send verification code' },
        { status: response.status }
      );
    }

    const data = await response.json();
    const nonce: string | undefined = data?.nonce;
    if (!nonce) {
      console.error('[mobile-magic-link] Stack Auth returned no nonce:', JSON.stringify(data).slice(0, 200));
      return NextResponse.json({ error: 'Failed to send verification code' }, { status: 502 });
    }

    // Park the nonce for mobile-verify-code. Best-effort: if this write
    // fails the user can still finish on a client that echoes the nonce
    // back, so don't fail the send on it.
    try {
      await db.otpNonces.put(email, nonce);
    } catch (err) {
      console.error('[mobile-magic-link] could not persist the sign-in nonce:', err);
    }

    return NextResponse.json({ success: true, nonce });
  } catch (error) {
    console.error('[mobile-magic-link] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
