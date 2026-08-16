'use client';

import { useStackApp, useUser } from "@stackframe/stack";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import Logo from '@/components/Logo';

export const dynamic = 'force-dynamic';

function SignInContent() {
  const app = useStackApp();
  const user = useUser({ or: "return-null" });
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [error, setError] = useState('');
  
  // Check for mobile callback parameter
  const mobileCallback = searchParams.get('mobile_callback');

  useEffect(() => {
    if (user) {
      // If there's a mobile callback, redirect to the mobile session endpoint
      if (mobileCallback) {
        router.push(`/api/auth/mobile-session?callback=${mobileCallback}`);
      } else {
        router.push('/');
      }
    }
  }, [user, router, mobileCallback]);

  const handleGoogleSignIn = async () => {
    await app.signInWithOAuth("google");
  };

  const handleMagicLinkSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      await app.sendMagicLinkEmail(email);
      setMagicLinkSent(true);
    } catch (err) {
      setError('Failed to send magic link. Please try again.');
      console.error('Magic link error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      await app.signInWithPasskey();
    } catch (err) {
      setError('Passkey sign-in failed. Please try another method.');
      console.error('Passkey error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (magicLinkSent) {
    return (
      <div className="page-shell-narrow flex min-h-screen items-center justify-center">
        <div className="w-full max-w-md animate-rise">
          <div className="hero-field card-focal overflow-hidden p-8">
            <div className="relative text-center">
              <div className="empty-state-icon mx-auto mb-5">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="display-2 mb-2">Check your email</h2>
              <p className="text-muted mb-1 break-words">
                We sent a magic link to <span className="font-medium text-foreground">{email}</span>
              </p>
              <p className="field-hint mb-6">
                Click the link in the email to sign in. The link will expire in 15 minutes.
              </p>
              <button
                onClick={() => {
                  setMagicLinkSent(false);
                  setEmail('');
                }}
                className="text-sm font-medium text-[--color-accent] transition-colors hover:text-[--color-accent-hover]"
              >
                Use a different email
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell-narrow flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md animate-rise">
        <div className="hero-field card-focal overflow-hidden p-8">
          <div className="relative">
            <div className="mb-6 flex justify-center">
              <Logo variant="lockup" animate="mount" size={36} />
            </div>
            <div className="mb-8 text-center">
              <h1 className="display-2 mb-2">Welcome back</h1>
              <p className="lede mx-auto">Polymarket for friends — put your money where your mouth is.</p>
            </div>

            {error && (
              <div className="tone-no tone-surface border rounded-xl px-3 py-2.5 text-sm mb-4">
                <span className="tone-text">{error}</span>
              </div>
            )}

            {/* Magic Link / OTP Sign In */}
            <form onSubmit={handleMagicLinkSignIn} className="mb-6">
              <label htmlFor="email" className="field-label">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !email}
                className="btn-primary w-full mt-3 px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Sending…' : 'Continue with Email'}
              </button>
            </form>

            {/* Passkey Sign In */}
            <button
              onClick={handlePasskeySignIn}
              disabled={isLoading}
              className="btn-glass w-full flex items-center justify-center gap-3 px-6 py-3 mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              <span>Continue with Passkey</span>
            </button>

            {/* Divider */}
            <div className="my-6 flex items-center gap-3">
              <div className="rule flex-1" />
              <span className="eyebrow">or</span>
              <div className="rule flex-1" />
            </div>

            {/* Google OAuth */}
            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="btn-glass w-full flex items-center justify-center gap-3 px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            <p className="field-hint text-center mt-6">
              By signing in, you agree to our Terms of Service and Privacy Policy
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    }>
      <SignInContent />
    </Suspense>
  );
}
