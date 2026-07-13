
'use client';
export const dynamic = 'force-dynamic';


import { useEffect, useState } from 'react';
import { useUser } from '@stackframe/stack';
import { useRouter } from 'next/navigation';
import { User } from '@/lib/types';

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
      <div className="max-w-4xl mx-auto px-4 py-8 mobile-page">
        <div className="h-9 w-40 skeleton rounded-xl mb-2" />
        <div className="h-5 w-56 skeleton rounded-lg mb-8" />
        <div className="h-20 skeleton rounded-2xl mb-8" />
        <div className="grid gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 skeleton rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 mobile-page animate-rise">
      <h1 className="font-display text-3xl font-semibold text-foreground mb-2">
        Users
      </h1>
      <p className="text-muted mb-8">
        View members from your groups
      </p>

      {groups.length === 0 ? (
        <div className="glass-subtle rounded-3xl p-12 text-center">
          <p className="text-muted mb-4">You're not part of any groups yet</p>
          <button
            onClick={() => router.push('/')}
            className="btn-primary"
          >
            Go to Home
          </button>
        </div>
      ) : (
        <>
          {/* Modern Group Selector */}
          <div className="mb-8">
            <label className="block text-sm font-medium text-muted mb-3">
              Select Group
            </label>
            <div className="relative group-dropdown">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="w-full glass rounded-2xl px-6 py-4 flex items-center justify-between transition focus:outline-none focus:border-brand-2/50 focus:ring-2 focus:ring-brand-2/20"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand-gradient rounded-xl flex items-center justify-center text-white font-semibold">
                    {selectedGroup?.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="text-left">
                    <div className="font-medium text-foreground">{selectedGroup?.name}</div>
                    <div className="text-sm text-muted-2">
                      {selectedGroup?.member_count} {selectedGroup?.member_count === 1 ? 'member' : 'members'}
                    </div>
                  </div>
                </div>
                <svg
                  className={`w-5 h-5 text-muted-2 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown Menu */}
              {dropdownOpen && (
                <div className="absolute z-10 w-full mt-2 glass-strong rounded-2xl overflow-hidden animate-fade-in">
                  {groups.map((group) => (
                    <button
                      key={group.id}
                      onClick={() => {
                        setSelectedGroupId(group.id);
                        setDropdownOpen(false);
                      }}
                      className={`w-full px-6 py-4 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left ${
                        selectedGroupId === group.id ? 'bg-brand-2/10' : ''
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-semibold ${
                        selectedGroupId === group.id
                          ? 'bg-brand-gradient text-white'
                          : 'bg-gray-100 text-muted'
                      }`}>
                        {group.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-foreground">{group.name}</div>
                        <div className="text-sm text-muted-2">
                          {group.member_count} {group.member_count === 1 ? 'member' : 'members'}
                        </div>
                      </div>
                      {selectedGroupId === group.id && (
                        <svg className="w-5 h-5 text-brand-2" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Users List */}
          {loadingMembers ? (
            <div className="grid gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-28 skeleton rounded-2xl" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="glass-subtle rounded-3xl p-12 text-center">
              <p className="text-muted">No members in this group yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-muted">
                  {users.length} {users.length === 1 ? 'member' : 'members'}
                </p>
              </div>
              <div className="grid gap-4 stagger">
                {sortedUsers.map((user, index) => {
                  const rank = index + 1;
                  const isTop = rank <= 3;
                  const rankStyles =
                    rank === 1
                      ? 'bg-amber-100 text-amber-700'
                      : rank === 2
                      ? 'bg-gray-200 text-gray-600'
                      : rank === 3
                      ? 'bg-brand-2/10 text-brand-2'
                      : 'bg-gray-100 text-muted-2';
                  return (
                  <div
                    key={user.id}
                    className={`glass glass-hover rounded-2xl p-6 ${
                      isTop ? 'border-brand-2/30' : ''
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold tabular-nums ${rankStyles}`}>
                        {rank}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-2xl font-display font-semibold text-foreground break-words">
                            @{user.username}
                          </span>
                          {user.streak > 0 && (
                            <span className="chip chip-yes">
                              🔥 {user.streak} streak
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-4 mt-4">
                          <div>
                            <div className="text-xs text-muted-2 mb-1">Total Bet</div>
                            <div className="text-xl font-medium text-foreground tabular-nums">
                              ${user.total_bet.toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-2 mb-1">Net Total</div>
                            <div
                              className={`text-xl font-medium tabular-nums ${
                                user.net_total > 0
                                  ? 'text-green-600'
                                  : user.net_total < 0
                                  ? 'text-red-600'
                                  : 'text-muted'
                              }`}
                            >
                              {user.net_total > 0 ? '+' : ''}${user.net_total.toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-2 mb-1">Win Streak</div>
                            <div className="text-xl font-medium text-foreground tabular-nums">🔥 {user.streak}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

