'use client';

import { StackProvider, useUser } from "@stackframe/stack";
import { stackClientApp, consumePendingMobileOAuthCallback } from "@/lib/stack-client";
import { ReactNode, useEffect, useState } from "react";
import NavigationProgress from "./NavigationProgress";
import UsernameModal from "./UsernameModal";

// Completes the iOS Google sign-in handoff. app/auth/signin/page.tsx stashes
// the mobile app's callback token (the same base64url `mobile_callback`
// value /api/auth/mobile-session already expects on its `callback` param) in
// localStorage right before firing signInWithOAuth('google'), because the
// Stack Auth SDK's own OAuth success path never returns to that page — it
// hard-navigates straight to "/" (see lib/stack-client.ts for the full
// read-from-the-SDK explanation). Mounted once at the root (inside
// StackProvider, alongside UsernameGate) so it catches the signed-in user on
// whatever page that redirect lands on, and finishes the trip to
// /api/auth/mobile-session, which redirects to wagerpals://oauth-callback
// with the real tokens. A no-op for every normal web sign-in, since nothing
// is ever stashed for those.
function MobileOAuthHandoff() {
  const user = useUser({ or: 'return-null' });

  useEffect(() => {
    if (!user) return;
    const mobileCallbackToken = consumePendingMobileOAuthCallback();
    if (!mobileCallbackToken) return;
    window.location.replace(`/api/auth/mobile-session?callback=${mobileCallbackToken}`);
  }, [user]);

  return null;
}

// The global "pick a username" gate. Used to mount only on app/page.tsx —
// every other signed-in route with username_selected=false could slip past
// it. Living here instead means every route under RootLayout gets it.
//
// Ensures the users row exists (POST /api/users, the same syncUser path the
// old app/page.tsx copy drove) and blocks with the non-dismissable
// UsernameModal until username_selected is true.
function UsernameGate({ children }: { children: ReactNode }) {
  const user = useUser({ or: 'return-null' });
  const [needsUsername, setNeedsUsername] = useState(false);

  useEffect(() => {
    if (!user) {
      setNeedsUsername(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const initialUsername = user.displayName || user.primaryEmail?.split('@')[0] || 'User';
        const response = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: user.id,
            username: initialUsername,
            // Don't set username_selected — let the user choose their own.
          }),
        });
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) setNeedsUsername(!data.username_selected);
        }
      } catch (error) {
        console.error('Failed to sync user:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleUsernameSubmit = async (username: string) => {
    if (!user) return;

    const response = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: user.id,
        username,
        username_selected: true,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to set username'); // UsernameModal shows this
    }
  };

  return (
    <>
      {needsUsername && (
        <UsernameModal onSubmit={handleUsernameSubmit} onSaved={() => setNeedsUsername(false)} />
      )}
      {children}
    </>
  );
}

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <StackProvider app={stackClientApp}>
      <NavigationProgress />
      <MobileOAuthHandoff />
      <UsernameGate>{children}</UsernameGate>
    </StackProvider>
  );
}
