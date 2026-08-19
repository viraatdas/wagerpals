'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import EventCard from '@/components/EventCard';
import EmptySlip from '@/components/EmptySlip';
import { EventWithStats } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default function AllEventsPage() {
  const router = useRouter();
  const user = useUser({ or: 'return-null' });
  const [groupedEvents, setGroupedEvents] = useState<{ group: any; events: EventWithStats[] }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
      return;
    }
    fetchAllEvents(user.id);
  }, [user, router]);

  const fetchAllEvents = async (uid: string) => {
    try {
      // Fetch user's groups
      const groupsResponse = await fetch(`/api/groups?userId=${uid}`);
      if (!groupsResponse.ok) throw new Error('Failed to fetch groups');
      const groups = await groupsResponse.json();

      // Fetch events for each group
      const groupEventsPromises = groups.map(async (group: any) => {
        const eventsResponse = await fetch(`/api/events?groupId=${group.id}`);
        if (!eventsResponse.ok) return { group, events: [] };
        const events = await eventsResponse.json();
        return { group, events: Array.isArray(events) ? events : [] };
      });

      const results = await Promise.all(groupEventsPromises);
      setGroupedEvents(results.filter((r) => r.events.length > 0));
    } catch (error) {
      console.error('Failed to fetch events:', error);
      setGroupedEvents([]);
    } finally {
      setLoading(false);
    }
  };

  // Live is currently-open wagers only (status 'active' — events never
  // expire, R2) — settled events belong to History (app/activity), not
  // here. Everything else about the data plumbing (grouping, per-group
  // fetch) is unchanged from before.
  const openEventsFor = (events: EventWithStats[]) => {
    return events.filter((e) => e.status === 'active');
  };

  if (!user) {
    return null; // Will redirect to signin
  }

  if (loading) {
    return (
      <div className="page-shell mobile-page">
        <div className="skeleton h-9 w-40 rounded-control mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="skeleton h-56 rounded-card" />
          <div className="skeleton h-56 rounded-card" />
          <div className="skeleton h-56 rounded-card" />
        </div>
      </div>
    );
  }

  const liveGroups = groupedEvents
    .map(({ group, events }) => ({ group, events: openEventsFor(events) }))
    .filter(({ events }) => events.length > 0);

  const totalLive = liveGroups.reduce((sum, { events }) => sum + events.length, 0);

  return (
    <div className="page-shell mobile-page">
      <div className="mb-8">
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1 font-sans text-sm font-medium text-ink-muted transition-colors duration-fast hover:text-ink"
        >
          ← Board
        </Link>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="font-display text-2xl text-ink sm:text-3xl">Live</h1>
          {totalLive > 0 && (
            <span className="font-mono text-lg font-medium text-emerald">{totalLive}</span>
          )}
        </div>
        <p className="mt-2 font-sans text-sm text-ink-secondary">
          Every currently-open wager across the groups you belong to.
        </p>
      </div>

      {liveGroups.length === 0 ? (
        <EmptySlip
          headline="Nothing live right now."
          body="Start a wager and it shows up here."
          action={{ label: 'Create event', href: '/create' }}
        />
      ) : (
        liveGroups.map(({ group, events }) => (
          <section key={group.id} className="mb-10">
            <div className="mb-4 flex min-w-0 items-baseline justify-between gap-3">
              <h2 className="min-w-0 truncate font-sans text-sm font-semibold uppercase tracking-wide text-ink-secondary">
                {group.name}
              </h2>
              <Link
                href={`/groups/${group.id}`}
                className="shrink-0 whitespace-nowrap font-sans text-sm font-medium text-emerald transition-colors duration-fast hover:opacity-80"
              >
                Open group →
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
