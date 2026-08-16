// A stand-in for `lib/stack.ts` (the real Stack Auth server app) used by
// integration tests.
//
// `lib/auth.ts` resolves the signed-in human by lazily importing
// `@/lib/stack` and calling `stackServerApp.getUser(...)`. A test registers a
// module-resolution hook that points that specifier at THIS file (see
// scripts/test-auth-consolidation.ts), so every other layer under test — the
// route handlers, lib/auth's three session paths, lib/sync-user, lib/db and
// Postgres itself — is the real thing. Only the third-party identity provider
// is faked.
//
// Session state lives on globalThis rather than in module scope so it is
// shared even if the stub is loaded under two different specifiers (e.g.
// `@/lib/stack` from lib/auth.ts and a relative path from the test).

/** The subset of a Stack Auth user that lib/auth.ts reads. */
export interface StubStackUser {
  id: string;
  primaryEmail: string | null;
  primaryEmailVerified: boolean;
  displayName: string | null;
  profileImageUrl: string | null;
  hasPassword: boolean;
  otpAuthEnabled: boolean;
  passkeyAuthEnabled: boolean;
  oauthProviders: Array<{ id: string }>;
}

interface StubState {
  /** The human whose Stack Auth cookie the browser is sending (web path). */
  cookieSession: StubStackUser | null;
  /** Access token -> human, for the mobile `Authorization: Bearer` path. */
  byAccessToken: Map<string, StubStackUser>;
}

const STATE_KEY = '__wagerpalsStackAuthStub__';

function state(): StubState {
  const g = globalThis as any;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = { cookieSession: null, byAccessToken: new Map() } as StubState;
  }
  return g[STATE_KEY] as StubState;
}

/** Build a Stack Auth user fixture; every field has a realistic default. */
export function stackUser(partial: Partial<StubStackUser> & { id: string }): StubStackUser {
  return {
    primaryEmail: null,
    primaryEmailVerified: false,
    displayName: null,
    profileImageUrl: null,
    hasPassword: false,
    otpAuthEnabled: false,
    passkeyAuthEnabled: false,
    oauthProviders: [],
    ...partial,
  };
}

/** Web browser: this human's session cookie is on every same-origin fetch. */
export function signInWeb(user: StubStackUser | null): void {
  state().cookieSession = user;
}

export function signOutWeb(): void {
  state().cookieSession = null;
}

/** Mobile app: hand out an access token for this human. */
export function issueAccessToken(token: string, user: StubStackUser): void {
  state().byAccessToken.set(token, user);
}

export function revokeAccessToken(token: string): void {
  state().byAccessToken.delete(token);
}

/** Forget every session. Call between test journeys. */
export function resetSessions(): void {
  state().cookieSession = null;
  state().byAccessToken.clear();
}

export const stackServerApp = {
  /**
   * Mirrors the three call shapes lib/auth.ts uses:
   *   1. { tokenStore: { accessToken, refreshToken } } — mobile bearer token
   *   2. { tokenStore: <request> }                     — x-stack-auth header
   *   3. no arguments                                  — nextjs cookie session
   * An unknown/expired access token resolves to null, exactly as the real
   * server app does, so 401 handling is exercised for real.
   */
  async getUser(options?: any): Promise<StubStackUser | null> {
    const s = state();
    const tokenStore = options?.tokenStore;

    if (tokenStore && typeof tokenStore.accessToken === 'string') {
      return s.byAccessToken.get(tokenStore.accessToken) ?? null;
    }

    // A request object was handed over (x-stack-auth path) or nothing at all
    // (cookie path): both resolve to whoever the browser is signed in as.
    return s.cookieSession;
  },
};
