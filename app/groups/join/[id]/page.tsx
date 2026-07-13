'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';

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
        headers: { 'Content-Type': 'application/json', 'x-stack-user-id': user.id },
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
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="glass rounded-3xl p-8 space-y-4">
          <div className="skeleton h-8 w-1/2 mx-auto rounded-xl" />
          <div className="skeleton h-24 rounded-2xl" />
          <div className="skeleton h-12 rounded-full" />
        </div>
      </div>
    );
  }

  if (error && !group) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="glass-strong rounded-3xl p-8 text-center animate-fade-in">
          <div className="text-red-500 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-display font-semibold text-foreground mb-2">Group Not Found</h1>
          <p className="text-muted mb-6">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="btn-primary"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  if (alreadyMember) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="glass-strong rounded-3xl p-8 text-center animate-fade-in">
          <div className="text-green-600 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-display font-semibold text-foreground mb-2">You're Already a Member!</h1>
          <p className="text-muted mb-6">
            You're already part of <span className="font-semibold text-foreground">{group?.name}</span>
          </p>
          <button
            onClick={() => router.push(`/groups/${params.id}`)}
            className="btn-primary"
          >
            Go to Group
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="glass-strong rounded-3xl p-8 animate-rise">
        {isNewUser && (
          <div className="glass-subtle rounded-2xl p-4 mb-6 border-sky-200 bg-sky-50">
            <p className="text-sky-700 text-center">
              👋 Welcome to WagerPals! You've been invited to join a group.
            </p>
          </div>
        )}

        <div className="text-center mb-8">
          <h1 className="text-3xl font-display font-semibold text-gradient mb-2">Join Group</h1>
          <p className="text-muted">You've been invited to join:</p>
        </div>

        <div className="glass-subtle rounded-2xl p-6 mb-6">
          <h2 className="text-2xl font-display font-semibold text-foreground mb-2">{group?.name}</h2>
          <div className="flex items-center gap-4 text-muted">
            <span>Group Code: <span className="font-mono font-semibold text-foreground">{group?.id}</span></span>
            <span className="text-muted-2">•</span>
            <span>{group?.member_count} {group?.member_count === 1 ? 'member' : 'members'}</span>
          </div>
        </div>

        {error && (
          <div className="glass-subtle rounded-2xl p-4 mb-6 border-red-200 bg-red-50">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleJoin}
            disabled={joining || hasPending}
            className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {hasPending ? 'Request Pending' : joining ? 'Joining...' : 'Join Group'}
          </button>
          <button
            onClick={() => router.push('/')}
            className="btn-glass"
          >
            Cancel
          </button>
        </div>

        <p className="text-sm text-muted-2 mt-6 text-center">
          Your join request will be pending until a group admin approves it.
        </p>
      </div>
    </div>
  );
}

