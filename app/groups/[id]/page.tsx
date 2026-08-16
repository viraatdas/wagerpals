'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import EventCard from '@/components/EventCard';
import { EventWithStats } from '@/lib/types';

export const dynamic = 'force-dynamic';

const getInitials = (name?: string) => {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
};

export default function GroupPage() {
  const params = useParams();
  const router = useRouter();
  const user = useUser({ or: "return-null" });
  const [group, setGroup] = useState<any>(null);
  const [events, setEvents] = useState<EventWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [copied, setCopied] = useState(false);
  const [wallet, setWallet] = useState<{ balance: number } | null>(null);

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
      return;
    }
    fetchGroupAndEvents(user.id);
  }, [params.id, user, router]);

  const fetchGroupAndEvents = async (uid: string) => {
    try {
      const [groupResponse, eventsResponse] = await Promise.all([
        fetch(`/api/groups?id=${params.id}`),
        fetch(`/api/events?groupId=${params.id}`),
      ]);
      if (!groupResponse.ok) {
        throw new Error('Failed to fetch group');
      }
      if (!eventsResponse.ok) {
        throw new Error('Failed to fetch events');
      }

      const groupData = await groupResponse.json();
      const eventsData = await eventsResponse.json();
      setGroup(groupData);
      setEvents(Array.isArray(eventsData) ? eventsData : []);

      // Check if user is admin
      const userMember = groupData.members.find((m: any) => m.user_id === uid);
      setIsAdmin(userMember?.role === 'admin');

      if (!groupData.is_public) {
        fetch(`/api/wallet?userId=${uid}`)
          .then((response) => response.ok ? response.json() : null)
          .then((walletData) => {
            if (walletData?.wallet) setWallet(walletData.wallet);
          })
          .catch((error) => console.error('Failed to fetch wallet:', error));
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyInviteLink = async () => {
    const inviteUrl = `${window.location.origin}/groups/join/${group.id}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const categorizeEvents = () => {
    const now = Date.now();
    const allOngoingEvents = events
      .filter((e) => e.status === 'active' && e.end_time > now)
      .sort((a, b) => a.end_time - b.end_time);

    const eventsWithTotals = allOngoingEvents.map(event => {
      const totalMoney = Object.values(event.side_stats).reduce((sum, stats) => sum + stats.total, 0);
      return { ...event, totalMoney };
    });

    const trendingEvents = [...eventsWithTotals]
      .sort((a, b) => {
        if (b.total_participants !== a.total_participants) {
          return b.total_participants - a.total_participants;
        }
        return b.totalMoney - a.totalMoney;
      })
      .slice(0, 3);

    const trendingIds = new Set(trendingEvents.map(e => e.id));
    const ongoingEvents = allOngoingEvents.filter(e => !trendingIds.has(e.id));

    const endedEvents = events
      .filter((e) => e.status === 'resolved' || (e.status === 'active' && e.end_time <= now))
      .sort((a, b) => b.end_time - a.end_time);

    return { trendingEvents, ongoingEvents, endedEvents };
  };

  if (!user) {
    return null; // Will redirect to signin
  }

  if (loading) {
    return (
      <div className="page-shell mobile-page">
        <div className="card-focal p-5 sm:p-8 space-y-6">
          <div className="space-y-3">
            <div className="skeleton h-3 w-32 rounded-full" />
            <div className="skeleton h-10 w-2/3 rounded-xl" />
          </div>
          <div className="flex flex-wrap gap-8">
            <div className="skeleton h-10 w-16 rounded-lg" />
            <div className="skeleton h-10 w-16 rounded-lg" />
            <div className="skeleton h-10 w-16 rounded-lg" />
          </div>
        </div>
        <div className="mt-10 space-y-4">
          <div className="skeleton h-3 w-28 rounded-full" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="skeleton h-40 rounded-2xl" />
            <div className="skeleton h-40 rounded-2xl" />
            <div className="skeleton h-40 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="page-shell mobile-page">
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="empty-state-title">Group not found</p>
          <p className="empty-state-body">This group may have been deleted, or the invite link is incorrect.</p>
          <Link href="/" className="btn-primary press">Go home</Link>
        </div>
      </div>
    );
  }

  const { trendingEvents, ongoingEvents, endedEvents } = categorizeEvents();
  const members: any[] = Array.isArray(group.members) ? group.members : [];

  return (
    <div className="page-shell mobile-page animate-rise">
      {/* Focal header */}
      <div className="card-focal p-5 sm:p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="eyebrow">
                Group <span className="font-mono normal-case tracking-normal">{group.id}</span>
              </span>
              {isAdmin && <span className="pill tone-accent">Admin</span>}
              {group.is_public ? (
                <span className="pill tone-info"><span className="tone-dot" />Free points</span>
              ) : (
                <span className="pill tone-yes"><span className="tone-dot" />Payments enabled</span>
              )}
            </div>
            <h1 className="display-2 break-words">{group.name}</h1>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              onClick={handleCopyInviteLink}
              className="btn-glass press text-sm w-full sm:w-auto"
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Link copied
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share group
                </>
              )}
            </button>
            {isAdmin && (
              <Link
                href={`/groups/${group.id}/admin`}
                className="btn-glass press text-sm w-full sm:w-auto text-center"
              >
                Manage group
              </Link>
            )}
            <Link
              href="/create"
              className="btn-primary press text-sm w-full sm:w-auto text-center"
            >
              Create event
            </Link>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <p className="eyebrow mb-1">Members</p>
            <p className="stat-value">{group.member_count}</p>
          </div>
          <div>
            <p className="eyebrow mb-1">Events</p>
            <p className="stat-value">{events.length}</p>
          </div>
          <div>
            <p className="eyebrow mb-1">Live now</p>
            <p className="stat-value">{trendingEvents.length + ongoingEvents.length}</p>
          </div>
        </div>

        {!group.is_public && (
          <div className="panel mt-6 p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="eyebrow">Wallet balance</p>
                <p className="numeral text-2xl text-foreground">${wallet?.balance?.toFixed(2) || '0.00'}</p>
                {group.resolver && (
                  <p className="text-sm text-muted truncate">
                    Resolver <span className="font-medium text-foreground">@{group.resolver.username || 'Unknown'}</span>
                  </p>
                )}
              </div>
              <Link
                href="/profile?wallet=deposit#wallet"
                className="btn-primary press w-full sm:w-auto text-sm text-center"
              >
                Deposit funds
              </Link>
            </div>
          </div>
        )}
      </div>

      {trendingEvents.length > 0 && (
        <section className="mt-10">
          <div className="section-head mb-5">
            <span className="eyebrow-accent eyebrow">Trending</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-rows">
            {trendingEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {ongoingEvents.length > 0 && (
        <section className="mt-10">
          <div className="section-head mb-5">
            <span className="eyebrow">Ongoing bets</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-rows">
            {ongoingEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {endedEvents.length > 0 && (
        <section className="mt-10">
          <div className="section-head mb-5">
            <span className="eyebrow">Ended bets</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-rows">
            {endedEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {events.length === 0 && (
        <div className="mt-10 empty-state">
          <div className="empty-state-icon">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m-6 4h6m-6 4h4M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
            </svg>
          </div>
          <p className="empty-state-title">No events yet</p>
          <p className="empty-state-body">This group hasn&apos;t made a bet yet. Create the group&apos;s first event to get things moving.</p>
          <Link href="/create" className="btn-primary press">Create the first event</Link>
        </div>
      )}

      {/* Member roster */}
      <section className="mt-10">
        <div className="section-head mb-5">
          <span className="eyebrow">Members</span>
        </div>
        {members.length > 0 ? (
          <div className="card overflow-hidden">
            <ul className="divide-y divide-hairline">
              {members.map((member: any) => (
                <li key={member.user_id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-sunken text-xs font-semibold text-muted">
                    {getInitials(member.username)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {member.username}
                  </span>
                  {member.user_id === group.created_by && (
                    <span className="pill tone-info shrink-0">Creator</span>
                  )}
                  {member.role === 'admin' && (
                    <span className="pill tone-accent shrink-0">Admin</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-3.998-4.2" />
              </svg>
            </div>
            <p className="empty-state-title">No members yet</p>
            <p className="empty-state-body">Share the invite link so friends can join this group.</p>
            <button onClick={handleCopyInviteLink} className="btn-primary press">Share invite link</button>
          </div>
        )}
      </section>
    </div>
  );
}
