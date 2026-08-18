
'use client';
export const dynamic = 'force-dynamic';


import { useEffect, useState } from 'react';
import Link from 'next/link';
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
      <div className="page-shell mobile-page">
        <div className="skeleton h-9 w-56 rounded-xl mb-6" />
        <div className="flex flex-wrap gap-2 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-28 rounded-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-56 rounded-2xl" />
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
    <div className="page-shell mobile-page animate-rise">
      <div className="mb-6">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="display-2">Explore Events</h1>
          <span className="numeral stat-value tone-text tone-accent">{filteredEvents.length}</span>
        </div>
        <p className="lede mt-2">
          Every open market that any public group has listed — sorted your way.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-6 sm:flex sm:flex-wrap">
        {filters.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`text-sm press ${filter === key ? 'btn-primary' : 'btn-glass'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredEvents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-rows">
          {filteredEvents.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
          </div>
          <h2 className="empty-state-title">No active public markets</h2>
          <p className="empty-state-body">
            Nothing is open right now. Check back soon, or head to one of your groups and list a market yourself.
          </p>
          <Link href="/all-events" className="btn-primary mt-2">
            View Your Events
          </Link>
        </div>
      )}
    </div>
  );
}
