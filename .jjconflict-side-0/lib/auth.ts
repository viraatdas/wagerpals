import { NextRequest, NextResponse } from 'next/server';

/**
 * Shape of an authenticated Stack Auth user, trimmed to the fields the rest
 * of the app needs. Never trust anything about a user's identity that did
 * not come from this — never from a client-supplied header or body field.
 */
export type AuthenticatedStackUser = {
  id: string;
  primaryEmail: string | null;
  primaryEmailVerified: boolean;
  displayName: string | null;
  profileImageUrl: string | null;
  hasPassword: boolean;
  otpAuthEnabled: boolean;
  passkeyAuthEnabled: boolean;
  oauthProviderIds: string[];
};

// Lazily import lib/stack.ts (which has `import "server-only"` at the top)
// so that modules which import from this file can still be loaded outside a
// Next.js server bundle (e.g. by verification scripts run under `tsx`).
async function getStackServerApp() {
  const mod = await import('@/lib/stack');
  return mod.stackServerApp;
}

function toAuthenticatedStackUser(user: any): AuthenticatedStackUser {
  return {
    id: user.id,
    primaryEmail: user.primaryEmail ?? null,
    primaryEmailVerified: !!user.primaryEmailVerified,
    displayName: user.displayName ?? null,
    profileImageUrl: user.profileImageUrl ?? null,
    hasPassword: !!user.hasPassword,
    otpAuthEnabled: !!user.otpAuthEnabled,
    passkeyAuthEnabled: !!user.passkeyAuthEnabled,
    oauthProviderIds: Array.isArray(user.oauthProviders)
      ? user.oauthProviders.map((p: any) => p.id)
      : [],
  };
}

// Memoize per-request so multiple calls within the same request handler
// don't re-hit Stack Auth (e.g. requireAuthUser followed by another check).
const requestUserCache = new WeakMap<NextRequest, Promise<AuthenticatedStackUser | null>>();

async function resolveAuthenticatedStackUser(request: NextRequest): Promise<AuthenticatedStackUser | null> {
  try {
    const stackServerApp = await getStackServerApp();

    // 1. Mobile app path: Authorization: Bearer <access token> (+ optional
    // x-stack-refresh-token header).
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null;
    if (accessToken) {
      const refreshToken = request.headers.get('x-stack-refresh-token') ?? '';
      const user = await stackServerApp.getUser({
        tokenStore: { accessToken, refreshToken },
      });
      if (user) return toAuthenticatedStackUser(user);
      return null;
    }

    // 2. x-stack-auth header present: resolve from the request-like object.
    if (request.headers.get('x-stack-auth')) {
      const user = await stackServerApp.getUser({ tokenStore: request });
      if (user) return toAuthenticatedStackUser(user);
      return null;
    }

    // 3. Web app path: same-origin fetches carry the Stack Auth nextjs
    // cookie session automatically.
    const user = await stackServerApp.getUser();
    if (user) return toAuthenticatedStackUser(user);
    return null;
  } catch (err) {
    // Fail closed: an unresolvable session is an unauthenticated one. Log the
    // message only — the stack is noisy and this fires on every anonymous
    // request in environments where Stack Auth can't be reached at all.
    console.error('[Auth] Failed to resolve authenticated Stack user:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Resolve the full authenticated Stack Auth user for this request, or null
 * if unauthenticated. Fails closed: any error resolving the session is
 * treated as unauthenticated rather than throwing.
 */
export async function getAuthenticatedStackUser(request: NextRequest): Promise<AuthenticatedStackUser | null> {
  let cached = requestUserCache.get(request);
  if (!cached) {
    cached = resolveAuthenticatedStackUser(request);
    requestUserCache.set(request, cached);
  }
  return cached;
}

/**
 * Verify the authenticated user from Stack Auth token/session.
 * Returns the user ID if valid, or null if unauthenticated.
 */
export async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  const user = await getAuthenticatedStackUser(request);
  return user?.id ?? null;
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
 * Require authentication and return the full Stack Auth user. Returns a 401
 * response if not authenticated.
 */
export async function requireAuthUser(request: NextRequest): Promise<{ user: AuthenticatedStackUser } | NextResponse> {
  const user = await getAuthenticatedStackUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  return { user };
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
