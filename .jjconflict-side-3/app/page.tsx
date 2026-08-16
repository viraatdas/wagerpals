'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import PushNotificationPrompt from '@/components/PushNotificationPrompt';
import UsernameModal from '@/components/UsernameModal';
import Toast, { ToastType } from '@/components/Toast';
import { Group } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default function Home() {
  const router = useRouter();
  const user = useUser({ or: "return-null" });
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
      return;
    }
    
    // Create/update returns the user row, so avoid an extra username lookup on first load.
    createOrUpdateUser().then(async (userData) => {
      if (userData) {
        setShowUsernameModal(!userData.username_selected);
      } else {
        await checkUsernameSelected();
      }
      checkAndHandlePendingInvite();
    });
    fetchGroups(user.id);
  }, [user, router]);

  const checkUsernameSelected = async () => {
    if (!user) return;
    
    try {
      const response = await fetch(`/api/users?id=${user.id}`);
      if (response.ok) {
        const userData = await response.json();
        // Show username modal if user hasn't selected a username yet
        if (!userData.username_selected) {
          setShowUsernameModal(true);
        }
      }
    } catch (error) {
      console.error('Failed to check username status:', error);
    }
  };

  const checkAndHandlePendingInvite = async () => {
    if (!user) return;
    
    // Check if there's a pending group invite (localStorage so it survives a
    // magic-link sign-in that lands in a different tab). Fall back to the old
    // sessionStorage key for links opened before this change.
    const pendingInvite =
      localStorage.getItem('pendingGroupInvite') ||
      sessionStorage.getItem('pendingGroupInvite');
    if (pendingInvite) {
      localStorage.removeItem('pendingGroupInvite');
      sessionStorage.removeItem('pendingGroupInvite');
      // Redirect to the join page
      router.push(`/groups/join/${pendingInvite}`);
    }
  };

  const createOrUpdateUser = async () => {
    if (!user) return;
    
    try {
      // Generate initial username from displayName or email
      let initialUsername = user.displayName || user.primaryEmail?.split('@')[0] || 'User';
      
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: user.id,
          username: initialUsername,
          // Don't set username_selected - let the user choose their username
        }),
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('Failed to create/update user:', error);
    }

    return null;
  };

  const handleUsernameSubmit = async (username: string) => {
    if (!user) return;
    
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: user.id,
          username: username,
          username_selected: true,
        }),
      });

      if (response.ok) {
        setShowUsernameModal(false);
        setToast({ message: 'Username set successfully!', type: 'success' });
      } else {
        const data = await response.json();
        throw new Error(data.error || 'Failed to set username');
      }
    } catch (error: any) {
      throw error; // Let UsernameModal handle the error display
    }
  };

  const fetchGroups = async (uid: string) => {
    try {
      const response = await fetch(`/api/groups?userId=${uid}`);
      if (!response.ok) throw new Error('Failed to fetch groups');
      const data = await response.json();
      setGroups(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch groups:', error);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim() || !user) return;

    setCreating(true);
    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-stack-user-id': user.id },
        body: JSON.stringify({
          name: groupName.trim(),
          created_by: user.id,
        }),
      });

      if (response.ok) {
        const newGroup = await response.json();
        setShowCreateModal(false);
        setGroupName('');
        router.push(`/groups/${newGroup.id}`);
      }
    } catch (error) {
      console.error('Failed to create group:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupCode.trim() || !user) return;

    setJoining(true);
    try {
      const response = await fetch('/api/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-stack-user-id': user.id },
        body: JSON.stringify({
          group_id: groupCode.trim(),
          user_id: user.id,
        }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setToast({ message: 'Join request submitted! Waiting for admin approval.', type: 'success' });
        setShowJoinModal(false);
        setGroupCode('');
        fetchGroups(user.id);
      } else {
        setToast({ message: data.error || 'Failed to join group', type: 'error' });
      }
    } catch (error) {
      console.error('Failed to join group:', error);
      setToast({ message: 'Failed to join group', type: 'error' });
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 mobile-page">
        <div className="space-y-4">
          <div className="skeleton h-32 rounded-3xl" />
          <div className="skeleton h-6 w-32 rounded-lg" />
          <div className="grid gap-3">
            <div className="skeleton h-20 rounded-2xl" />
            <div className="skeleton h-20 rounded-2xl" />
            <div className="skeleton h-20 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect to signin
  }

  return (
    <>
      {showUsernameModal && <UsernameModal onSubmit={handleUsernameSubmit} />}
      <PushNotificationPrompt />
      <Toast
        isOpen={toast !== null}
        onClose={() => setToast(null)}
        message={toast?.message || ''}
        type={toast?.type || 'info'}
      />

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-strong rounded-3xl p-6 max-w-md w-full animate-fade-in">
            <h2 className="text-2xl font-display font-semibold text-foreground mb-4">Create a Group</h2>
            <form onSubmit={handleCreateGroup}>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name"
                className="w-full bg-gray-50 border border-gray-200 text-foreground placeholder:text-muted-2 rounded-xl px-3 py-2 focus:outline-none focus:bg-white focus:border-brand-2/50 focus:ring-2 focus:ring-brand-2/20 transition mb-6"
                required
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn-glass flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="btn-primary flex-1 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showJoinModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-strong rounded-3xl p-6 max-w-md w-full animate-fade-in">
            <h2 className="text-2xl font-display font-semibold text-foreground mb-4">Join a Group</h2>
            <form onSubmit={handleJoinGroup}>
              <input
                type="text"
                value={groupCode}
                onChange={(e) => setGroupCode(e.target.value)}
                placeholder="Enter 6-digit group code"
                maxLength={6}
                className="w-full bg-gray-50 border border-gray-200 text-foreground placeholder:text-muted-2 rounded-xl px-3 py-2 focus:outline-none focus:bg-white focus:border-brand-2/50 focus:ring-2 focus:ring-brand-2/20 transition mb-6 text-center text-2xl tracking-widest"
                required
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="btn-glass flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={joining}
                  className="btn-primary flex-1 disabled:opacity-50"
                >
                  {joining ? 'Joining...' : 'Join'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-b from-background-2 to-background">
        <div className="relative max-w-4xl mx-auto px-4 py-10 sm:py-14 animate-rise">
          <div className="flex items-center gap-3 mb-3">
            <img src="/icons/icon-192x192.svg" alt="" className="w-11 h-11 rounded-2xl ring-1 ring-black/[0.06] animate-floaty" />
            <h1 className="text-4xl sm:text-5xl font-display font-semibold text-foreground">
              WagerPals
            </h1>
          </div>
          <p className="text-muted text-lg mb-6 max-w-lg">
            Bet on anything with friends. Real stakes, real fun.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary w-full sm:w-auto"
            >
              Create Group
            </button>
            <button
              onClick={() => setShowJoinModal(true)}
              className="btn-glass w-full sm:w-auto"
            >
              Join Group
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 mobile-page">
        {groups.length > 0 ? (
          <div className="animate-rise">
            <h2 className="text-lg font-display font-semibold text-foreground mb-4">
              Your Groups
            </h2>
            <div className="grid gap-3 stagger">
              {groups.map((group) => (
                <Link
                  key={group.id}
                  href={`/groups/${group.id}`}
                  className="glass glass-hover rounded-2xl p-5 cursor-pointer group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ${
                        group.is_public
                          ? 'bg-gradient-to-br from-sky-500 to-indigo-500'
                          : 'bg-brand-gradient'
                      }`}>
                        {group.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-foreground truncate group-hover:text-brand-2 transition-colors">
                          {group.name}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-2">
                          <span>{group.member_count} members</span>
                          <span className="w-1 h-1 rounded-full bg-gray-300" />
                          <span className="font-mono">{group.id}</span>
                          {group.is_admin && (
                            <>
                              <span className="w-1 h-1 rounded-full bg-gray-300" />
                              <span className="text-brand-2">Admin</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {group.is_public ? (
                        <span className="chip text-sky-700 bg-sky-50 border-sky-200">
                          Public
                        </span>
                      ) : (
                        <span className="chip">
                          Private
                        </span>
                      )}
                      <svg className="w-4 h-4 text-muted-2 group-hover:text-brand-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="glass-subtle rounded-3xl text-center py-12 px-6 animate-rise">
            <div className="text-5xl mb-4">🎲</div>
            <h2 className="text-xl font-display font-semibold text-foreground mb-2">No groups yet</h2>
            <p className="text-muted mb-6">Create a group and invite your friends to start wagering</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary"
            >
              Create Your First Group
            </button>
          </div>
        )}
      </div>
    </>
  );
}
