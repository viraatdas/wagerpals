
'use client';
export const dynamic = 'force-dynamic';


import { useEffect, useState } from 'react';
import { useUser } from '@stackframe/stack';
import { useRouter } from 'next/navigation';
import { User } from '@/lib/types';
import AvatarStack from '@/components/AvatarStack';
import EmptySlip from '@/components/EmptySlip';
import { handle } from '@/lib/utils';

interface Group {
  id: string;
  name: string;
  member_count: number;
}

interface GroupMember {
  user_id: string;
  username: string;
  role: string;
  status: string;
}

function netTone(net: number): 'tone-win' | 'tone-loss' | 'tone-neutral' {
  if (net > 0) return 'tone-win';
  if (net < 0) return 'tone-loss';
  return 'tone-neutral';
}

function netText(net: number): string {
  return `${net > 0 ? '+' : ''}$${net.toFixed(2)}`;
}

function initialOf(name: string | undefined): string {
  return (name || '?').charAt(0).toUpperCase();
}

export default function UsersPage() {
  const user = useUser({ or: "return-null" });
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
      return;
    }
    fetchGroups();
  }, [user, router]);

  useEffect(() => {
    if (selectedGroupId) {
      fetchGroupMembers();
    }
  }, [selectedGroupId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (dropdownOpen && !target.closest('.group-dropdown')) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const fetchGroups = async () => {
    if (!user) return;
    try {
      const response = await fetch(`/api/groups?userId=${user.id}`);
      const data = await response.json();
      setGroups(Array.isArray(data) ? data : []);

      // Auto-select first group if available
      if (data.length > 0) {
        setSelectedGroupId(data[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch groups:', error);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupMembers = async () => {
    setLoadingMembers(true);
    try {
      const response = await fetch(`/api/groups/members?groupId=${selectedGroupId}`);
      const members = await response.json();

      // Filter only active members
      const activeMembers = members.filter((m: GroupMember) => m.status === 'active');
      setGroupMembers(activeMembers);

      // Fetch user details for all members
      const userDetailsPromises = activeMembers.map((member: GroupMember) =>
        fetch(`/api/users?id=${member.user_id}`).then(res => res.json())
      );

      const userDetails = await Promise.all(userDetailsPromises);
      setUsers(userDetails.filter(u => u && !u.error));
    } catch (error) {
      console.error('Failed to fetch group members:', error);
      setGroupMembers([]);
      setUsers([]);
    } finally {
      setLoadingMembers(false);
    }
  };

  const sortedUsers = [...users].sort((a, b) => {
    // Primary sort: net_total (descending)
    if (b.net_total !== a.net_total) {
      return b.net_total - a.net_total;
    }
    // Secondary sort: total_bet (descending)
    return b.total_bet - a.total_bet;
  });

  const selectedGroup = groups.find(g => g.id === selectedGroupId);

  if (loading) {
    return (
      <div className="page-shell-narrow mobile-page">
        <div className="skeleton-line mb-2 h-8 w-40" />
        <div className="skeleton-line mb-8 h-4 w-56" />
        <div className="skeleton h-16 rounded-[var(--radius-card)] mb-6" />
        <div className="skeleton h-32 rounded-[var(--radius-panel)] mb-4" />
        <div className="card overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 last:border-b-0">
              <div className="skeleton h-6 w-6 rounded-full flex-none" />
              <div className="skeleton h-8 w-8 rounded-[var(--radius-chip)] flex-none" />
              <div className="skeleton-line flex-1" />
              <div className="skeleton-line w-16 flex-none" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const [first, second, third, ...rest] = sortedUsers;

  return (
    <div className="page-shell-narrow mobile-page animate-rise">
      <p className="eyebrow mb-2">Leaderboard</p>
      <h1 className="display-1 mb-2">Friends</h1>
      <p className="lede mb-8">View members from your groups, ranked by net.</p>

      {groups.length === 0 ? (
        <EmptySlip
          headline="No friends in yet."
          body="Join or create a group to see who's up."
          action={{ label: 'Go to board', onClick: () => router.push('/') }}
        />
      ) : (
        <>
          {/* Group selector */}
          <div className="mb-8">
            <label className="field-label" id="group-selector-label">
              Select group
            </label>
            <div className="group-dropdown relative">
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                aria-haspopup="listbox"
                aria-expanded={dropdownOpen}
                aria-labelledby="group-selector-label"
                className="card press flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:border-[var(--color-border-strong)] sm:px-5 sm:py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="tone-accent tone-surface flex h-10 w-10 flex-none items-center justify-center rounded-[var(--radius-control)] border text-sm font-bold tone-text">
                    {initialOf(selectedGroup?.name)}
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="truncate font-medium text-foreground">{selectedGroup?.name}</div>
                    <div className="text-xs text-muted">
                      {selectedGroup?.member_count} {selectedGroup?.member_count === 1 ? 'member' : 'members'}
                    </div>
                  </div>
                </div>
                <svg
                  className={`h-5 w-5 flex-none text-muted transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {dropdownOpen && (
                <div
                  role="listbox"
                  aria-labelledby="group-selector-label"
                  className="card animate-sheet absolute z-10 mt-2 w-full overflow-hidden p-1.5"
                >
                  {groups.map((group) => {
                    const active = selectedGroupId === group.id;
                    return (
                      <button
                        type="button"
                        key={group.id}
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          setSelectedGroupId(group.id);
                          setDropdownOpen(false);
                        }}
                        className={`press flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-left transition-colors ${
                          active ? 'tone-accent tone-surface' : 'hover:bg-[var(--color-surface-sunken)]'
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 flex-none items-center justify-center rounded-[var(--radius-chip)] text-xs font-bold ${
                            active ? 'bg-[var(--color-accent)] text-ink-inverse' : 'bg-[var(--color-surface-sunken)] text-muted'
                          }`}
                        >
                          {initialOf(group.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">{group.name}</div>
                          <div className="text-xs text-muted">
                            {group.member_count} {group.member_count === 1 ? 'member' : 'members'}
                          </div>
                        </div>
                        {active && (
                          <svg className="h-4 w-4 flex-none tone-text" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Leaderboard */}
          {loadingMembers ? (
            <div className="space-y-4">
              <div className="skeleton h-32 rounded-[var(--radius-panel)]" />
              <div className="card overflow-hidden">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 last:border-b-0">
                    <div className="skeleton h-6 w-6 rounded-full flex-none" />
                    <div className="skeleton h-8 w-8 rounded-[var(--radius-chip)] flex-none" />
                    <div className="skeleton-line flex-1" />
                    <div className="skeleton-line w-16 flex-none" />
                  </div>
                ))}
              </div>
            </div>
          ) : users.length === 0 ? (
            <EmptySlip
              headline="No members in this group yet"
              body="Invite friends and their bets land on the leaderboard."
            />
          ) : (
            <div className="space-y-4">
              <div className="section-head">
                <span className="eyebrow">
                  {users.length} {users.length === 1 ? 'member' : 'members'}
                </span>
              </div>

              {/* Rank 1 — the focal point */}
              {first && (
                <div className="tone-gold card-focal hero-field rail-top relative overflow-hidden p-5 sm:p-7">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                      <AvatarStack people={[{ username: first.username, avatar_url: first.avatar_url }]} size="lg" className="flex-none" />
                      <div className="min-w-0">
                        <p className="eyebrow tone-text mb-1">Rank 1</p>
                        <p className="market-title truncate text-xl text-foreground sm:text-2xl">
                          {handle(first.username)}
                        </p>
                        {first.streak > 0 && (
                          <span className="pill mt-2 inline-flex">🔥 {first.streak} streak</span>
                        )}
                      </div>
                    </div>
                    <div className="flex-none text-right">
                      <p className="eyebrow mb-1">Net</p>
                      <p className="numeral tone-text text-3xl sm:text-4xl">{netText(first.net_total)}</p>
                    </div>
                  </div>
                  <div className="tone-surface mt-6 flex items-center gap-8 rounded-[var(--radius-control)] border px-4 py-3">
                    <div>
                      <p className="eyebrow mb-1">Total Bet</p>
                      <p className="stat-value">${first.total_bet.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="eyebrow mb-1">Win Streak</p>
                      <p className="stat-value">{first.streak}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Ranks 2-3 — reduced */}
              {(second || third) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[second, third].map((u, i) =>
                    u ? (
                      <div key={u.id} className={`${netTone(u.net_total)} card flex items-center justify-between gap-3 p-4`}>
                        <div className="flex min-w-0 items-center gap-3">
                          <AvatarStack people={[{ username: u.username, avatar_url: u.avatar_url }]} size="md" className="flex-none" />
                          <div className="min-w-0">
                            <p className="eyebrow mb-0.5">Rank {i + 2}</p>
                            <p className="truncate font-medium text-foreground">{handle(u.username)}</p>
                          </div>
                        </div>
                        <div className="flex-none text-right">
                          <p className="numeral tone-text text-lg">{netText(u.net_total)}</p>
                          {u.streak > 0 && <p className="mt-0.5 font-mono text-xs text-muted">🔥 {u.streak} streak</p>}
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              )}

              {/* Rest — dense table */}
              {rest.length > 0 && (
                <div className="card overflow-hidden">
                  {rest.map((u, i) => {
                    const rank = i + 4;
                    return (
                      <div
                        key={u.id}
                        className={`${netTone(u.net_total)} flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--color-surface-sunken)]`}
                      >
                        <span className="numeral w-6 flex-none text-sm text-muted">{rank}</span>
                        <AvatarStack people={[{ username: u.username, avatar_url: u.avatar_url }]} size="sm" className="flex-none" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {handle(u.username)}
                            {u.streak > 0 && (
                              <span className="ml-1.5 font-mono text-xs font-normal text-muted">🔥 {u.streak} streak</span>
                            )}
                          </p>
                        </div>
                        <div className="flex-none text-right">
                          <span className="numeral tone-text text-sm">{netText(u.net_total)}</span>
                          <span className="ml-2 hidden text-xs text-muted sm:inline">
                            bet ${u.total_bet.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
