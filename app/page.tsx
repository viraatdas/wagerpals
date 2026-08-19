'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import PushNotificationPrompt from '@/components/PushNotificationPrompt';
import UsernameModal from '@/components/UsernameModal';
import Toast, { ToastType } from '@/components/Toast';
import EmptySlip from '@/components/EmptySlip';
import EventCard from '@/components/EventCard';
import { EventWithStats, Group } from '@/lib/types';

export const dynamic = 'force-dynamic';

// A group as returned by GET /api/groups?userId= — Group plus the counts and
// viewer-role fields that endpoint adds. See app/api/groups/route.ts.
interface GroupSummary extends Group {
  member_count: number;
  is_admin: boolean;
}

// Board ordering: currently-open wagers first (most recent deadline first),
// then everything else (ended/settled) newest first. Mirrors the ordering
// db.events.getAllWithStats already applies per-group; re-applied here
// because the Board combines multiple groups' event lists client-side.
function boardOrder(a: EventWithStats, b: EventWithStats): number {
  const aOpen = a.status === 'active' ? 0 : 1;
  const bOpen = b.status === 'active' ? 0 : 1;
  if (aOpen !== bOpen) return aOpen - bOpen;
  return b.end_time - a.end_time;
}

export default function Home() {
  const router = useRouter();
  const user = useUser({ or: 'return-null' });

  // Signed-in board state
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [events, setEvents] = useState<EventWithStats[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  // Signed-out masthead state — public events only, no group data.
  const [publicEvents, setPublicEvents] = useState<EventWithStats[]>([]);
  const [loadingPublic, setLoadingPublic] = useState(true);

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
      fetchPublicEvents();
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
    fetchBoard(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
        setToast({ message: 'Username saved.', type: 'success' });
      } else {
        const data = await response.json();
        throw new Error(data.error || 'Failed to set username');
      }
    } catch (error: any) {
      throw error; // Let UsernameModal handle the error display
    }
  };

  // Fetches the caller's groups, then every group's events, and combines
  // them into one board-ordered list. Reuses the same two endpoints
  // app/all-events/page.tsx already drives (GET /api/groups?userId=,
  // GET /api/events?groupId=) — no new API surface.
  const fetchBoard = async (uid: string) => {
    setLoading(true);
    try {
      const groupsResponse = await fetch(`/api/groups?userId=${uid}`);
      if (!groupsResponse.ok) throw new Error('Failed to fetch groups');
      const groupsData = await groupsResponse.json();
      const groupList: GroupSummary[] = Array.isArray(groupsData) ? groupsData : [];
      setGroups(groupList);

      const eventLists = await Promise.all(
        groupList.map(async (group) => {
          const res = await fetch(`/api/events?groupId=${group.id}`);
          if (!res.ok) return [] as EventWithStats[];
          const data = await res.json();
          return Array.isArray(data) ? (data as EventWithStats[]) : [];
        })
      );

      setEvents(eventLists.flat().sort(boardOrder));
    } catch (error) {
      console.error('Failed to load board:', error);
      setGroups([]);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  // Signed-out visitors get whatever the board's own public feed already
  // returns from the unauthenticated GET /api/events (no groupId) — the
  // same endpoint app/explore/page.tsx drives. No new endpoint.
  const fetchPublicEvents = async () => {
    setLoadingPublic(true);
    try {
      const response = await fetch('/api/events');
      const data = await response.json();
      setPublicEvents(Array.isArray(data) ? data.sort(boardOrder) : []);
    } catch (error) {
      console.error('Failed to load public board:', error);
      setPublicEvents([]);
    } finally {
      setLoadingPublic(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim() || !user) return;

    setCreating(true);
    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      } else {
        const data = await response.json().catch(() => ({}));
        setToast({ message: data.error || "Couldn't create the group — try again.", type: 'error' });
      }
    } catch (error) {
      console.error('Failed to create group:', error);
      setToast({ message: "Couldn't create the group — try again.", type: 'error' });
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupCode.trim(),
          user_id: user.id,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setToast({ message: 'Join request sent — waiting on an admin.', type: 'success' });
        setShowJoinModal(false);
        setGroupCode('');
        fetchBoard(user.id);
      } else {
        setToast({ message: data.error || "Couldn't join the group — try again.", type: 'error' });
      }
    } catch (error) {
      console.error('Failed to join group:', error);
      setToast({ message: "Couldn't join the group — try again.", type: 'error' });
    } finally {
      setJoining(false);
    }
  };

  const visibleEvents =
    selectedGroupId === 'all' ? events : events.filter((e) => e.group_id === selectedGroupId);
  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;
  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));

  const chipClass = (active: boolean) =>
    `shrink-0 whitespace-nowrap rounded-chip px-3 py-1.5 font-sans text-sm font-medium transition-colors duration-fast ${
      active
        ? 'bg-emerald text-on-emerald'
        : 'border border-line bg-card text-ink-secondary hover:border-ink-secondary'
    }`;

  // ---------------------------------------------------------------------
  // Signed-out: compact masthead + sign-in CTA, real public cards below.
  // ---------------------------------------------------------------------
  if (!user) {
    return (
      <div className="page-shell mobile-page">
        <div className="mb-6 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate font-sans text-sm text-ink-secondary">
            Bet on anything with friends.
          </p>
          <Link
            href="/auth/signin"
            className="shrink-0 rounded-control bg-emerald px-4 py-2 font-sans text-sm font-medium text-on-emerald transition-colors duration-fast hover:opacity-90"
          >
            Sign in
          </Link>
        </div>

        {loadingPublic ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="skeleton h-56 rounded-card" />
            <div className="skeleton h-56 rounded-card" />
            <div className="skeleton h-56 rounded-card" />
          </div>
        ) : publicEvents.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {publicEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <EmptySlip
            headline="Nothing public right now."
            body="Sign in to see your groups' board."
            action={{ label: 'Sign in', href: '/auth/signin' }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="page-shell mobile-page">
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
            className="rounded-panel bg-card p-6 max-w-md w-full shadow-elev-4"
          >
            <h2 id="create-group-title" className="mb-4 font-display text-xl text-ink">
              Create a Group
            </h2>
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
                  className="flex-1 rounded-control border border-line bg-card px-4 py-2 font-sans text-sm font-medium text-ink-secondary transition-colors duration-fast hover:border-ink-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 rounded-control bg-emerald px-4 py-2 font-sans text-sm font-medium text-on-emerald transition-colors duration-fast hover:opacity-90 disabled:opacity-50"
                >
                  {creating ? 'Creating…' : 'Create Group'}
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
            className="rounded-panel bg-card p-6 max-w-md w-full shadow-elev-4"
          >
            <h2 id="join-group-title" className="mb-4 font-display text-xl text-ink">
              Join a Group
            </h2>
            <form onSubmit={handleJoinGroup}>
              <label className="field-label" htmlFor="join-group-code">Group code</label>
              <input
                id="join-group-code"
                type="text"
                value={groupCode}
                onChange={(e) => setGroupCode(e.target.value)}
                placeholder="Enter 6-digit group code"
                maxLength={6}
                className="input mb-6 text-center text-2xl tracking-widest font-mono"
                required
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="flex-1 rounded-control border border-line bg-card px-4 py-2 font-sans text-sm font-medium text-ink-secondary transition-colors duration-fast hover:border-ink-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={joining}
                  className="flex-1 rounded-control bg-emerald px-4 py-2 font-sans text-sm font-medium text-on-emerald transition-colors duration-fast hover:opacity-90 disabled:opacity-50"
                >
                  {joining ? 'Joining…' : 'Join Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl text-ink sm:text-3xl">Board</h1>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setShowJoinModal(true)}
            className="rounded-control border border-line bg-card px-3 py-1.5 font-sans text-sm font-medium text-ink-secondary transition-colors duration-fast hover:border-ink-secondary"
          >
            Join a group
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-control bg-emerald px-3 py-1.5 font-sans text-sm font-medium text-on-emerald transition-colors duration-fast hover:opacity-90"
          >
            New group
          </button>
        </div>
      </div>

      {loading ? (
        <>
          <div className="mb-6 flex gap-2">
            <div className="skeleton h-9 w-16 rounded-chip" />
            <div className="skeleton h-9 w-24 rounded-chip" />
            <div className="skeleton h-9 w-24 rounded-chip" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="skeleton h-56 rounded-card" />
            <div className="skeleton h-56 rounded-card" />
            <div className="skeleton h-56 rounded-card" />
          </div>
        </>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-2 overflow-x-auto pb-1">
            <button onClick={() => setSelectedGroupId('all')} className={chipClass(selectedGroupId === 'all')}>
              All
            </button>
            {groups.map((group) => (
              <button
                key={group.id}
                onClick={() => setSelectedGroupId(group.id)}
                className={chipClass(selectedGroupId === group.id)}
              >
                {group.name}
              </button>
            ))}
            <Link href="/explore" className={chipClass(false)}>
              Explore →
            </Link>
          </div>

          {/* Group context row — the chips only FILTER; this is the doorway
              into the group itself (roster, admin, settings), which the old
              groups dashboard used to provide. Without it /groups/[id] is
              unreachable from the Board. */}
          {selectedGroup && (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-line bg-card px-4 py-3">
              <span className="font-sans font-medium text-ink">{selectedGroup.name}</span>
              <span className="font-mono text-xs text-ink-muted">
                {selectedGroup.member_count} {selectedGroup.member_count === 1 ? 'member' : 'members'}
              </span>
              <span className="ml-auto flex items-center gap-3">
                <Link
                  href={`/groups/${selectedGroup.id}`}
                  className="font-sans text-sm font-medium text-emerald hover:text-emerald/80"
                >
                  Open group →
                </Link>
                {selectedGroup.is_admin && (
                  <Link
                    href={`/groups/${selectedGroup.id}/admin`}
                    className="font-sans text-sm font-medium text-ink-secondary hover:text-ink"
                  >
                    Admin
                  </Link>
                )}
              </span>
            </div>
          )}

          {visibleEvents.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  groupName={selectedGroupId === 'all' ? groupNameById.get(event.group_id) : undefined}
                />
              ))}
            </div>
          ) : (
            <EmptySlip
              headline="No board yet."
              body="Start a group, then start the first bet."
              action={{ label: 'Create a group', onClick: () => setShowCreateModal(true) }}
            />
          )}
        </>
      )}
    </div>
  );
}
