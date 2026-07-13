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
      <div className="max-w-6xl mx-auto px-4 py-8 mobile-page">
        <div className="space-y-4">
          <div className="skeleton h-9 w-56 rounded-xl" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="skeleton h-56 rounded-3xl" />
            <div className="skeleton h-56 rounded-3xl" />
            <div className="skeleton h-56 rounded-3xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 mobile-page animate-rise">
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-foreground transition-colors mb-3"
        >
          ← Back to Groups
        </Link>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-foreground mb-2">
          All Events
        </h1>
        <p className="text-base sm:text-lg text-muted">
          Events from all your groups
        </p>
      </div>

      {groupedEvents.length === 0 ? (
        <div className="glass rounded-3xl text-center py-14 px-6 animate-fade-in">
          <p className="text-muted mb-5">No events in any of your groups yet.</p>
          <Link
            href="/create"
            className="btn-primary"
          >
            Create Event
          </Link>
        </div>
      ) : (
        groupedEvents.map(({ group, events }) => {
          const { ongoing, ended } = categorizeEvents(events);

          return (
            <section key={group.id} className="mb-12">
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center mb-4">
                <h2 className="font-display text-xl sm:text-2xl font-semibold text-foreground pb-2 inline-block break-words border-b-2 border-brand-2/50">
                  {group.name}
                </h2>
                <Link
                  href={`/groups/${group.id}`}
                  className="w-fit text-sm font-medium text-brand-2 hover:text-foreground transition-colors"
                >
                  View Group →
                </Link>
              </div>

              {ongoing.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-muted mb-3">Ongoing</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
                    {ongoing.map((event) => (
                      <EventCard key={event.id} event={event} />
                    ))}
                  </div>
                </div>
              )}

              {ended.length > 0 && (
                <div>
                  <h3 className="text-lg font-medium text-muted mb-3">Ended</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
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
