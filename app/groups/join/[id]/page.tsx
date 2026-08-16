'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import Logo from '@/components/Logo';

export const dynamic = 'force-dynamic';

export default function JoinGroupPage() {
  const params = useParams();
  const router = useRouter();
  const user = useUser({ or: "return-null" });
  const [group, setGroup] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);

  useEffect(() => {
    if (!user) {
      // Store the invite code for after signin
      if (typeof window !== 'undefined') {
        // localStorage (not sessionStorage) so the invite survives magic-link
        // sign-in, which frequently opens the link in a new tab.
        localStorage.setItem('pendingGroupInvite', params.id as string);
      }
      router.push('/auth/signin');
      return;
    }

    // Ensure user exists in database before proceeding
    createOrUpdateUser().then(() => {
      fetchGroup();
    });
  }, [params.id, user, router]);

  const createOrUpdateUser = async () => {
    if (!user) return;

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.id,
          username: user.displayName || user.primaryEmail || 'User',
        }),
      });

      // Check if this was a new user signup
      if (response.ok) {
        const userData = await response.json();
        // If user was just created (has default values), show welcome message
        if (userData.total_bet === 0 && userData.net_total === 0) {
          setIsNewUser(true);
        }
      }
    } catch (error) {
      console.error('Failed to create/update user:', error);
    }
  };

  const fetchGroup = async () => {
    try {
      const response = await fetch(`/api/groups?id=${params.id}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError('Group not found. Please check the invite link.');
        } else {
          setError('Failed to load group information.');
        }
        setLoading(false);
        return;
      }
      const data = await response.json();
      setGroup(data);

      // Check if user is already a member
      if (user) {
        const isMember = data.members.some((m: any) => m.user_id === user.id && m.status === 'active');
        const pendingForUser = data.pending_requests?.some((m: any) => m.user_id === user.id);

        if (isMember) {
          setAlreadyMember(true);
        } else if (pendingForUser) {
          setHasPending(true);
          setError('You already have a pending join request for this group.');
        }
      }
    } catch (err) {
      console.error('Failed to fetch group:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!user) return;

    setJoining(true);
    setError(null);

    try {
      const response = await fetch('/api/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: params.id,
          user_id: user.id,
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          setError(data.error || 'Failed to join group');
        } else {
          setError('Failed to join group. Please try again.');
        }
        setJoining(false);
        return;
      }

      // Successfully submitted join request
      // For now, redirect to home - admin will need to approve
      router.push('/?joined=pending');
    } catch (err) {
      console.error('Failed to join group:', err);
      setError('Something went wrong. Please try again.');
      setJoining(false);
    }
  };

  if (!user) {
    return null; // Will redirect to signin
  }

  if (loading) {
    return (
      <div className="page-shell-narrow mobile-page">
        <div className="hero-field rounded-[var(--radius-panel)] border border-hairline p-8 sm:p-10 text-center space-y-5">
          <div className="skeleton h-14 w-14 rounded-full mx-auto" />
          <div className="skeleton h-3 w-32 mx-auto rounded-full" />
          <div className="skeleton h-9 w-2/3 mx-auto rounded-xl" />
          <div className="skeleton h-16 rounded-2xl" />
          <div className="skeleton h-12 rounded-full" />
        </div>
      </div>
    );
  }

  if (error && !group) {
    return (
      <div className="page-shell-narrow mobile-page">
        <div className="card rail-top tone-no p-8 text-center animate-rise">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full tone-surface border">
            <svg className="w-6 h-6 tone-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="display-3 mb-2">Group not found</h1>
          <p className="text-sm text-muted mb-6 max-w-[34ch] mx-auto">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="btn-primary press"
          >
            Go to home
          </button>
        </div>
      </div>
    );
  }

  if (alreadyMember) {
    return (
      <div className="page-shell-narrow mobile-page">
        <div className="card rail-top tone-yes p-8 text-center animate-rise">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full tone-surface border">
            <svg className="w-6 h-6 tone-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="display-3 mb-2">You&apos;re already in</h1>
          <p className="text-sm text-muted mb-6">
            You&apos;re already part of <span className="font-semibold text-foreground">{group?.name}</span>.
          </p>
          <button
            onClick={() => router.push(`/groups/${params.id}`)}
            className="btn-primary press"
          >
            Go to group
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell-narrow mobile-page">
      <div className="hero-field rounded-[var(--radius-panel)] border border-hairline p-8 sm:p-10 animate-rise">
        <div className="flex flex-col items-center text-center">
          <Logo variant="mark" animate="mount" size={56} className="mb-6" />

          {isNewUser && (
            <div className="tone-info tone-surface border rounded-2xl px-4 py-3 mb-6 w-full">
              <p className="text-sm font-medium tone-text">
                Welcome to WagerPals — you&apos;ve been invited to join a group.
              </p>
            </div>
          )}

          <p className="eyebrow mb-3">You&apos;re invited to join</p>
          <h1 className="display-1 break-words mb-3">{group?.name}</h1>
          <p className="lede mb-6">
            Join to place bets, track the odds, and settle up with your friends.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
            <span className="pill tone-neutral">
              <span className="font-mono normal-case tracking-normal">{group?.id}</span>
            </span>
            <span className="pill tone-neutral">
              {group?.member_count} {group?.member_count === 1 ? 'member' : 'members'}
            </span>
          </div>

          {hasPending ? (
            <div className="tone-pending tone-surface border rounded-2xl px-5 py-4 w-full mb-6 text-left">
              <p className="text-sm font-semibold tone-text mb-1">Request pending</p>
              <p className="text-sm text-muted">{error}</p>
            </div>
          ) : error ? (
            <div className="tone-no tone-surface border rounded-2xl px-5 py-4 w-full mb-6 text-left">
              <p className="text-sm tone-text">{error}</p>
            </div>
          ) : null}

          <div className="flex w-full gap-3">
            <button
              onClick={handleJoin}
              disabled={joining || hasPending}
              className="btn-primary press flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {hasPending ? 'Request pending' : joining ? 'Joining…' : 'Join group'}
            </button>
            <button
              onClick={() => router.push('/')}
              className="btn-glass press"
            >
              Cancel
            </button>
          </div>

          <p className="field-hint mt-6">
            Your join request will be pending until a group admin approves it.
          </p>
        </div>
      </div>
    </div>
  );
}
