'use client';
import { StackClientApp } from "@stackframe/stack";

export const stackClientApp = new StackClientApp({
  tokenStore: "nextjs-cookie",
  urls: {
    signIn: "/auth/signin",
    afterSignIn: "/",
    afterSignOut: "/auth/signin",
  },
});

// --- Mobile OAuth handoff ---------------------------------------------------
//
// The iOS app's Google sign-in drives the Stack Auth React SDK's own
// signInWithOAuth('google') (app/auth/signin/page.tsx's `auto=google`
// effect). That call round-trips through Stack Auth's authorize endpoint and
// Google and lands back on Stack's own `/handler/oauth-callback` page. Read
// straight from node_modules/@stackframe/stack's client-app-impl.js
// (callOAuthCallback): on success it does a *hard*
// `window.location.replace(afterSignIn)` — straight to "/" — because
// `afterCallbackRedirectUrl` is only ever set by `addNewOAuthProviderOrScope`
// ("link" flow); a plain signInWithOAuth sign-in never sets it. The
// `?mobile_callback=` query param that got the user onto /auth/signin in the
// first place is on a URL the browser never returns to, so it's gone by the
// time the SDK's own redirect lands — the mobile handoff (POST tokens back to
// wagerpals://oauth-callback) never fires and the in-app browser sheet is
// just left sitting on the signed-in web home page.
//
// Fix: stash the callback in localStorage (same-origin storage on
// www.wagerpals.io, so it survives visiting Stack Auth's and Google's
// domains along the way, unlike anything encoded into the redirect chain's
// own URLs) right before firing signInWithOAuth, and let ClientProviders
// pick it back up on whatever page the SDK lands the signed-in user on.
//
// NOTE on encoding: `mobile_callback` (as read from `useSearchParams()`) is
// already the base64url token app/api/auth/mobile-oauth/route.ts produced
// (`Buffer.from(callbackUrl).toString('base64url')`) — /auth/signin never
// decodes it, it just forwards the same token straight through to
// /api/auth/mobile-session's `callback` param (see the existing `user &&
// mobileCallback` effect below in that file). So what's saved/consumed here
// is that token verbatim, not a raw wagerpals:// URL — do not re-encode it.
const MOBILE_OAUTH_STORAGE_KEY = 'wagerpals:mobile-oauth-callback';
const MOBILE_OAUTH_MAX_AGE_MS = 10 * 60 * 1000; // OAuth round-trips through Google; 10 minutes is generous.

export function savePendingMobileOAuthCallback(mobileCallbackToken: string) {
  try {
    localStorage.setItem(
      MOBILE_OAUTH_STORAGE_KEY,
      JSON.stringify({ mobileCallbackToken, savedAt: Date.now() })
    );
  } catch {
    // localStorage unavailable (private mode, storage full, etc.) — the flow
    // falls back to landing on "/" signed in, same as before this fix.
  }
}

// One-shot: removes the stored value the moment it's read, so an abandoned
// mobile flow can't hijack a later, unrelated web sign-in in the same
// browser data store past its own attempt. Returns the same base64url token
// /api/auth/mobile-session expects on its `callback` param — pass it through
// unchanged, do not encode it again.
export function consumePendingMobileOAuthCallback(): string | null {
  try {
    const raw = localStorage.getItem(MOBILE_OAUTH_STORAGE_KEY);
    if (!raw) return null;
    localStorage.removeItem(MOBILE_OAUTH_STORAGE_KEY);
    const parsed = JSON.parse(raw);
    if (typeof parsed?.mobileCallbackToken !== 'string' || typeof parsed?.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > MOBILE_OAUTH_MAX_AGE_MS) return null;
    return parsed.mobileCallbackToken;
  } catch {
    return null;
  }
}
