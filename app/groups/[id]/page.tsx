'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import EventCard from '@/components/EventCard';
import { EventWithStats } from '@/lib/types';

export const dynamic = 'force-dynamic';

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
        fetch(`/api/wallet?userId=${uid}`, {
          headers: { 'x-stack-user-id': uid },
        })
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
      <div className="max-w-6xl mx-auto px-4 py-8 mobile-page">
        <div className="space-y-4">
          <div className="skeleton h-9 w-2/3 rounded-xl" />
          <div className="skeleton h-24 rounded-2xl" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="skeleton h-40 rounded-3xl" />
            <div className="skeleton h-40 rounded-3xl" />
            <div className="skeleton h-40 rounded-3xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 mobile-page">
        <div className="glass-subtle rounded-3xl text-center py-12 px-6">
          <p className="text-center text-muted">Group not found</p>
        </div>
      </div>
    );
  }

  const { trendingEvents, ongoingEvents, endedEvents } = categorizeEvents();

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 mobile-page animate-rise">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:justify-between md:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
            <h1 className="text-3xl sm:text-4xl font-display font-semibold text-foreground break-words leading-tight">
              {group.name}
            </h1>
            {isAdmin && (
              <span className="chip text-brand-2 border-brand-2/30 bg-brand-2/10">
                Admin
              </span>
            )}
          </div>
          <p className="text-base sm:text-lg text-muted">
            Group Code: <span className="font-mono font-semibold text-foreground">{group.id}</span>
            <span className="mx-2 text-muted-2">•</span>
            {group.member_count} members
          </p>
          {!group.is_public && (
            <div className="mt-4 glass rounded-2xl p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <span className="chip chip-yes w-fit">
                    Payments enabled
                  </span>
                  <p className="text-sm text-muted">
                    Wallet: <span className="font-semibold text-green-700">${wallet?.balance?.toFixed(2) || '0.00'}</span>
                  </p>
                  {group.resolver && (
                    <p className="text-sm text-muted break-all">
                      Resolver: <span className="font-medium text-foreground">@{group.resolver.username || 'Unknown'}</span>
                    </p>
                  )}
                </div>
                <Link
                  href="/profile?wallet=deposit#wallet"
                  className="btn-primary w-full sm:w-auto text-sm"
                >
                  Deposit Funds
                </Link>
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              onClick={handleCopyInviteLink}
              className="btn-glass w-full sm:w-auto text-sm"
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Link Copied!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share Group
                </>
              )}
            </button>
            {isAdmin && (
              <Link
                href={`/groups/${group.id}/admin`}
                className="btn-glass w-full sm:w-auto text-sm"
              >
                Manage Group
              </Link>
            )}
            <Link
              href="/create"
              className="btn-primary w-full sm:w-auto text-sm"
            >
              Create Event
            </Link>
          </div>
        </div>
      </div>

      {trendingEvents.length > 0 && (
        <section className="mb-12">
          <h2 className="text-xl sm:text-2xl font-display font-semibold text-foreground mb-4 inline-block border-b-2 border-red-300 pb-2">
            🔥 Trending
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6 stagger">
            {trendingEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {ongoingEvents.length > 0 && (
        <section className="mb-12">
          <h2 className="text-xl sm:text-2xl font-display font-semibold text-foreground mb-4 inline-block border-b-2 border-brand-2/60 pb-2">
            Ongoing Bets
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6 stagger">
            {ongoingEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {endedEvents.length > 0 && (
        <section className="mb-12">
          <h2 className="text-xl sm:text-2xl font-display font-semibold text-foreground mb-4 inline-block border-b-2 border-gray-300 pb-2">
            Ended Bets
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6 stagger">
            {endedEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {events.length === 0 && (
        <div className="glass-subtle rounded-3xl text-center py-12 px-6">
          <p className="text-muted mb-4">No events yet. Create the first one!</p>
          <Link
            href="/create"
            className="btn-primary"
          >
            Create Event
          </Link>
        </div>
      )}
    </div>
  );
}
