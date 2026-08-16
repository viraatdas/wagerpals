'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import EventCard from '@/components/EventCard';
import { EventWithStats } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default function AllEventsPage() {
  const router = useRouter();
  const user = useUser({ or: "return-null" });
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
      setGroupedEvents(results.filter(r => r.events.length > 0));
    } catch (error) {
      console.error('Failed to fetch events:', error);
      setGroupedEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const categorizeEvents = (events: EventWithStats[]) => {
    const now = Date.now();
    const ongoing = events.filter((e) => e.status === 'active' && e.end_time > now);
    const ended = events.filter((e) => e.status === 'resolved' || (e.status === 'active' && e.end_time <= now));
    return { ongoing, ended };
  };

  if (!user) {
    return null; // Will redirect to signin
  }

  if (loading) {
    return (
      <div className="page-shell mobile-page">
        <div className="skeleton-line w-24 mb-4" />
        <div className="skeleton h-9 w-56 rounded-xl mb-2" />
        <div className="skeleton-line w-64 mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="skeleton h-56 rounded-2xl" />
          <div className="skeleton h-56 rounded-2xl" />
          <div className="skeleton h-56 rounded-2xl" />
        </div>
      </div>
    );
  }

  const totalEvents = groupedEvents.reduce((sum, { events }) => sum + events.length, 0);

  return (
    <div className="page-shell mobile-page animate-rise">
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-foreground transition-colors mb-3 press"
        >
          ← Back to Groups
        </Link>
        <div className="eyebrow mb-2">Your Markets</div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="display-2">All Events</h1>
          {totalEvents > 0 && (
            <span className="numeral stat-value tone-text tone-accent">{totalEvents}</span>
          )}
        </div>
        <p className="lede mt-2">
          Every event across all the groups you belong to, grouped by group.
        </p>
      </div>

      {groupedEvents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="empty-state-title">No events in any of your groups yet</h2>
          <p className="empty-state-body">
            Once a group you're in lists a market, it'll show up here. Start one yourself to get things moving.
          </p>
          <Link href="/create" className="btn-primary mt-2">
            Create Event
          </Link>
        </div>
      ) : (
        groupedEvents.map(({ group, events }) => {
          const { ongoing, ended } = categorizeEvents(events);

          return (
            <section key={group.id} className="mb-12">
              <div className="section-head mb-4 min-w-0">
                <h2 className="eyebrow truncate min-w-0 max-w-[60%]">{group.name}</h2>
                <Link
                  href={`/groups/${group.id}`}
                  className="w-fit shrink-0 text-sm font-medium tone-text tone-accent press whitespace-nowrap"
                >
                  View Group →
                </Link>
              </div>

              {ongoing.length > 0 && (
                <div className="mb-6">
                  <h3 className="eyebrow mb-3 opacity-70">Ongoing</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-rows">
                    {ongoing.map((event) => (
                      <EventCard key={event.id} event={event} />
                    ))}
                  </div>
                </div>
              )}

              {ended.length > 0 && (
                <div>
                  <h3 className="eyebrow mb-3 opacity-70">Ended</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-rows">
                    {ended.map((event) => (
                      <EventCard key={event.id} event={event} />
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
