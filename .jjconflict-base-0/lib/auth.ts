import { NextRequest, NextResponse } from 'next/server';

/**
 * Verify the authenticated user from Stack Auth token.
 * Returns the user ID if valid, or null if unauthenticated.
 */
export async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  const accessToken = authHeader?.replace('Bearer ', '');

  if (!accessToken) {
    // Fallback: check for x-user-id header (used by web app where Stack Auth
    // is already validated client-side via useUser())
    const userId = request.headers.get('x-stack-user-id');
    if (userId) return userId;
    return null;
  }

  try {
    // Verify token with Stack Auth server
    const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
    const secretKey = process.env.STACK_SECRET_SERVER_KEY;
    const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;

    if (!projectId || !secretKey || !publishableKey) {
      console.error('[Auth] Missing Stack Auth environment variables');
      return null;
    }

    const response = await fetch('https://api.stack-auth.com/api/v1/users/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-Stack-Project-Id': projectId,
        'X-Stack-Publishable-Client-Key': publishableKey,
      },
    });

    if (!response.ok) {
      return null;
    }

    const userData = await response.json();
    return userData.id || null;
  } catch {
    return null;
  }
}

/**
 * Require authentication. Returns a 401 response if not authenticated,
 * or the authenticated user ID if valid.
 */
export async function requireAuth(request: NextRequest): Promise<{ userId: string } | NextResponse> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  return { userId };
}

/**
 * Ensure the authenticated user matches the user_id in the request body.
 * Prevents impersonation attacks.
 */
export function verifyUserMatch(authUserId: string, requestUserId: string): NextResponse | null {
  if (authUserId !== requestUserId) {
    return NextResponse.json(
      { error: 'User ID mismatch - you can only perform actions as yourself' },
      { status: 403 }
    );
  }
  return null;
}
