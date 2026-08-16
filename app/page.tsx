'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import PushNotificationPrompt from '@/components/PushNotificationPrompt';
import UsernameModal from '@/components/UsernameModal';
import Toast, { ToastType } from '@/components/Toast';
import Logo from '@/components/Logo';
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

  // Presentation-only derived stats — built solely from data already in scope.
  const groupCount = groups.length;
  const publicGroupCount = groups.filter((g) => g.is_public).length;
  const totalMembers = groups.reduce((sum, g) => sum + (g.member_count || 0), 0);

  if (loading) {
    return (
      <div className="page-shell mobile-page">
        <div className="skeleton h-40 rounded-3xl mb-8" />
        <div className="section-head mb-4">
          <div className="skeleton-line w-28" />
        </div>
        <div className="grid gap-3">
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
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
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-group-title"
            className="card-focal animate-sheet p-6 max-w-md w-full"
          >
            <h2 id="create-group-title" className="display-3 mb-4">Create a Group</h2>
            <form onSubmit={handleCreateGroup}>
              <label className="field-label" htmlFor="create-group-name">Group name</label>
              <input
                id="create-group-name"
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name"
                className="input mb-6"
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
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="join-group-title"
            className="card-focal animate-sheet p-6 max-w-md w-full"
          >
            <h2 id="join-group-title" className="display-3 mb-4">Join a Group</h2>
            <form onSubmit={handleJoinGroup}>
              <label className="field-label" htmlFor="join-group-code">Group code</label>
              <input
                id="join-group-code"
                type="text"
                value={groupCode}
                onChange={(e) => setGroupCode(e.target.value)}
                placeholder="Enter 6-digit group code"
                maxLength={6}
                className="input mb-6 text-center text-2xl tracking-widest numeral"
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

      {/* Hero */}
      <div className="hero-field">
        <div className="relative page-shell pb-10 sm:pb-14">
          <div className="flex items-center gap-3 mb-4">
            <Logo variant="mark" animate="mount" className="w-11 h-11 rounded-2xl" />
          </div>
          <h1 className="display-1 mb-3">WagerPals</h1>
          <p className="lede mb-7">
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

          {groupCount > 0 && (
            <div className="mt-9 grid grid-cols-3 gap-4 max-w-md">
              <div>
                <div className="eyebrow mb-1">Groups</div>
                <div className="stat-value numeral">{groupCount}</div>
              </div>
              <div>
                <div className="eyebrow mb-1">Members</div>
                <div className="stat-value numeral">{totalMembers}</div>
              </div>
              <div>
                <div className="eyebrow mb-1">Public</div>
                <div className="stat-value numeral">{publicGroupCount}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="page-shell mobile-page pt-8">
        {groups.length > 0 ? (
          <div>
            <div className="section-head mb-4">
              <h2 className="eyebrow">Your Groups</h2>
            </div>
            <div className="grid gap-3 stagger-rows">
              {groups.map((group) => (
                <Link
                  key={group.id}
                  href={`/groups/${group.id}`}
                  className="card card-interactive press block rounded-2xl p-5 min-w-0"
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
                        <h3 className="market-title text-base truncate">
                          {group.name}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted mt-0.5">
                          <span>{group.member_count} members</span>
                          <span className="w-1 h-1 rounded-full bg-gray-300" />
                          <span className="font-mono truncate">{group.id}</span>
                          {group.is_admin && (
                            <>
                              <span className="w-1 h-1 rounded-full bg-gray-300" />
                              <span className="tone-text tone-accent">Admin</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {group.is_public ? (
                        <span className="pill tone-info">Public</span>
                      ) : (
                        <span className="pill tone-neutral">Private</span>
                      )}
                      <svg className="w-4 h-4 text-muted-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6-3a4 4 0 10-4-4" />
              </svg>
            </div>
            <h2 className="empty-state-title">No groups yet</h2>
            <p className="empty-state-body">
              Create a group and invite your friends to start wagering, or join one with a code someone shared with you.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row mt-2">
              <button
                onClick={() => setShowCreateModal(true)}
                className="btn-primary"
              >
                Create Your First Group
              </button>
              <button
                onClick={() => setShowJoinModal(true)}
                className="btn-glass"
              >
                Join a Group
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
