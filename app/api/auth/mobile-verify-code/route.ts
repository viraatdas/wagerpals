import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Step 2 of email (OTP) sign-in for the mobile app: redeem the code.
//
// This route used to POST `{ email, code }` to Stack Auth's
// `/auth/otp/sign-in`. That endpoint takes ONLY `code`, and rejects the
// request outright when `email` is present:
//
//   SCHEMA_ERROR: body.code must be exactly 45 characters;
//   body contains unknown properties: email
//
// 45 = the 6-character emailed code + the 39-character nonce that
// mobile-magic-link received from `send-sign-in-code`. The nonce is issued
// only to whoever asked for the code, so it has to be carried across the two
// requests. The installed app posts `{ email, code }` and has no nonce to
// give, so we look up the one mobile-magic-link stored.
//
// A `nonce` in the body wins when present, so a future app build can carry it
// itself and skip the lookup. Both shapes work.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const { email, code } = body ?? {};
    const suppliedNonce: string | undefined =
      typeof body?.nonce === 'string' && body.nonce ? body.nonce : undefined;

    if (!email || !code) {
      return NextResponse.json(
        { error: 'Email and code are required' },
        { status: 400 }
      );
    }

    const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID || '';
    const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || '';

    if (!projectId || !publishableKey) {
      console.error('[mobile-verify-code] Stack Auth env vars are missing');
      return NextResponse.json({ error: 'Sign-in is unavailable right now' }, { status: 500 });
    }

    let nonce = suppliedNonce;
    if (!nonce) {
      try {
        nonce = (await db.otpNonces.take(email)) ?? undefined;
      } catch (err) {
        console.error('[mobile-verify-code] could not read the stored nonce:', err);
      }
    }

    if (!nonce) {
      // Either the code was never requested through this server, or the
      // stored nonce expired / was already redeemed. Ask for a fresh code
      // rather than sending Stack Auth a request it will reject on length.
      return NextResponse.json(
        { error: 'That code has expired. Request a new one.' },
        { status: 401 }
      );
    }

    const trimmedCode = String(code).trim().toUpperCase();

    const response = await fetch('https://api.stack-auth.com/api/v1/auth/otp/sign-in', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-stack-project-id': projectId,
        'x-stack-publishable-client-key': publishableKey,
        'x-stack-access-type': 'client',
      },
      body: JSON.stringify({ code: `${trimmedCode}${nonce}` }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[mobile-verify-code] Stack Auth sign-in failed:', response.status, errorData);
      // The nonce was consumed by the lookup above. Put it back so a typo'd
      // digit doesn't force the user to request a whole new code.
      if (!suppliedNonce) {
        try {
          await db.otpNonces.put(email, nonce);
        } catch (err) {
          console.error('[mobile-verify-code] could not restore the nonce:', err);
        }
      }
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
      user_id: userData.id || data.user_id || '',
      email: userData.primary_email || email,
      display_name: userData.display_name || email.split('@')[0],
    });
  } catch (error) {
    console.error('[mobile-verify-code] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
