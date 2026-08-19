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

