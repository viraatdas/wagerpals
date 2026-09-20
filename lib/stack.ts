import "server-only";
import { StackServerApp } from "@stackframe/stack";

export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  urls: {
    signIn: "/auth/signin",
    afterSignIn: "/",
    afterSignOut: "/auth/signin",
  },
  // NOTE: never set `baseUrl` here. In the Stack SDK, `baseUrl` is the URL of
  // Stack Auth's OWN API server (default https://api.stack-auth.com), not this
  // app's URL. A previous version passed NEXT_PUBLIC_APP_URL, which aimed every
  // server-side session lookup at https://www.wagerpals.io/api/v1/users/me →
  // 404 → every authenticated API returned 401 the moment that env var was set
  // in production. The client SDK (lib/stack-client.ts) correctly omits it,
  // which is why the browser looked signed in while the server disagreed.
});


// Session lifetime for the native mobile sign-in paths (google-native,
// apple-native, and the App Review demonstration mode).
//
// WHY THIS IS PASSED EXPLICITLY: the Stack SDK types `createSession(options?)`
// as optional, but the compiled runtime dereferences `options.expiresInMillis`
// unconditionally. Calling `createSession()` with no argument therefore throws
//
//   TypeError: Cannot read properties of undefined (reading 'expiresInMillis')
//
// which the route's outer catch turned into a generic 500. That is exactly the
// error App Review hit on "Sign in with Apple" in build 23 — the types said the
// call was fine, so it type-checked and shipped broken. Google native sign-in
// carried the same bug. Always pass an explicit options object here.
export const MOBILE_SESSION_EXPIRES_IN_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
