
'use client';
export const dynamic = 'force-dynamic';


import { useEffect, useState } from 'react';
import EventCard from '@/components/EventCard';
import { EventWithStats } from '@/lib/types';

export default function Explore() {
  const [events, setEvents] = useState<EventWithStats[]>([]);
  const [filter, setFilter] = useState<'all' | 'ending-soon' | 'most-joined' | 'new'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      const response = await fetch('/api/events');
      const data = await response.json();
      setEvents(data);
    } catch (error) {
      console.error('Failed to fetch events:', error);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredEvents = () => {
    const now = Date.now();
    let filtered = events.filter((e) => e.status === 'active' && e.end_time > now);

    switch (filter) {
      case 'ending-soon':
        return [...filtered].sort((a, b) => a.end_time - b.end_time);
      case 'most-joined':
        return [...filtered].sort((a, b) => b.total_bets - a.total_bets);
      case 'new':
        return [...filtered].sort((a, b) => b.end_time - a.end_time);
      default:
        return filtered;
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 mobile-page">
        <div className="h-9 w-56 skeleton rounded-xl mb-6" />
        <div className="flex flex-wrap gap-2 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 w-28 skeleton rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 skeleton rounded-3xl" />
          ))}
        </div>
      </div>
    );
  }

  const filteredEvents = getFilteredEvents();

  const filters: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'ending-soon', label: 'Ending Soon' },
    { key: 'most-joined', label: 'Most Joined' },
    { key: 'new', label: 'New' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 mobile-page animate-rise">
      <h1 className="font-display text-2xl sm:text-3xl font-semibold text-foreground mb-6">
        Explore Events
      </h1>

      <div className="grid grid-cols-2 gap-2 mb-6 sm:flex sm:flex-wrap">
        {filters.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`text-sm ${filter === key ? 'btn-primary' : 'btn-glass'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredEvents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
          {filteredEvents.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <div className="glass-subtle rounded-3xl p-12 text-center">
          <p className="text-muted">No active events found</p>
        </div>
      )}
    </div>
  );
}
