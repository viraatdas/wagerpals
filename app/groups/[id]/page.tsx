'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import EventCard from '@/components/EventCard';
import { EventWithStats } from '@/lib/types';
import AvatarStack from '@/components/AvatarStack';
import EmptySlip from '@/components/EmptySlip';
import { handle } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default function GroupPage() {
  const params = useParams();
  const router = useRouter();
  const user = useUser({ or: "return-null" });
  const [group, setGroup] = useState<any>(null);
  const [events, setEvents] = useState<EventWithStats[]>([]);
  const [loading, setLoading] = useState(true);
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

      // The API only hands the roster to active members; a non-member gets an
      // invite preview instead, so send them to the page built for that.
      if (groupData.is_member === false) {
        router.push(`/groups/join/${params.id}`);
        return;
      }

      setGroup(groupData);
      setEvents(Array.isArray(eventsData) ? eventsData : []);

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

  // Events never expire (R2) — status is 'active' | 'resolved' only, so
  // there's no third "ended but unresolved" bucket anymore. Both lists keep
  // the order the API already returned them in (recency-first, per
  // db.events.getAllWithStats), since there's no end_time left to sort by.
  const categorizeEvents = () => {
    const allOngoingEvents = events.filter((e) => e.status === 'active');

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

    const settledEvents = events.filter((e) => e.status === 'resolved');

    return { trendingEvents, ongoingEvents, settledEvents };
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
        <EmptySlip
          headline="Group not found"
          body="This group is gone, or the link's wrong."
          action={{ label: 'Go home', href: '/' }}
        />
      </div>
    );
  }

  const { trendingEvents, ongoingEvents, settledEvents } = categorizeEvents();
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
            {group.is_admin && (
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

      {settledEvents.length > 0 && (
        <section className="mt-10">
          <div className="section-head mb-5">
            <span className="eyebrow">Settled bets</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-rows">
            {settledEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {events.length === 0 && (
        <EmptySlip
          className="mt-10"
          headline="No action yet."
          body="Create the group's first event."
          action={{ label: 'Create the first event', href: '/create' }}
        />
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
                  <AvatarStack people={[{ username: member.username }]} size="sm" className="flex-none" />
                  <span className="min-w-0 flex-1 truncate font-sans text-sm font-medium text-foreground">
                    {handle(member.username)}
                  </span>
                  {member.user_id === group.created_by && (
                    <span className="pill tone-info shrink-0">Creator</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptySlip
            headline="No one's here yet."
            body="Share the invite link so friends can join this group."
            action={{ label: 'Share invite link', onClick: handleCopyInviteLink }}
          />
        )}
      </section>
    </div>
  );
}
