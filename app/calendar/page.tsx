'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import { EventWithStats } from '@/lib/types';

export const dynamic = 'force-dynamic';

type CalendarEvent = EventWithStats & { group_name: string };
type EventState = 'ongoing' | 'ended' | 'resolved';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const stateChipClasses: Record<EventState, string> = {
  ongoing: 'bg-neon-mint/10 border-neon-mint/25 text-neon-mint',
  ended: 'bg-neon-amber/10 border-neon-amber/25 text-neon-amber',
  resolved: 'bg-white/5 border-white/10 text-muted',
};

const stateDotClasses: Record<EventState, string> = {
  ongoing: 'bg-neon-mint',
  ended: 'bg-neon-amber',
  resolved: 'bg-muted-2',
};

const stateLabels: Record<EventState, string> = {
  ongoing: 'Live',
  ended: 'Awaiting resolution',
  resolved: 'Resolved',
};

function getEventState(event: CalendarEvent, now: number): EventState {
  if (event.status === 'resolved') return 'resolved';
  return event.end_time > now ? 'ongoing' : 'ended';
}

// Local-date key so events land on the day the deadline hits in the user's timezone.
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m, d);
}

function getMonthCells(year: number, month: number): Date[] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((firstWeekday + daysInMonth) / 7);
  const cells: Date[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    cells.push(new Date(year, month, i - firstWeekday + 1));
  }
  return cells;
}

export default function CalendarPage() {
  const router = useRouter();
  const user = useUser({ or: 'return-null' });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedKey, setSelectedKey] = useState(() => dayKey(new Date()));

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
        if (!eventsResponse.ok) return [];
        const groupEvents = await eventsResponse.json();
        return (Array.isArray(groupEvents) ? groupEvents : []).map(
          (e: EventWithStats): CalendarEvent => ({ ...e, group_name: group.name })
        );
      });

      const results = await Promise.all(groupEventsPromises);
      setEvents(results.flat());
    } catch (error) {
      console.error('Failed to fetch events:', error);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = dayKey(new Date(event.end_time));
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    map.forEach((list) => {
      list.sort((a, b) => a.end_time - b.end_time);
    });
    return map;
  }, [events]);

  const cells = useMemo(() => getMonthCells(viewYear, viewMonth), [viewYear, viewMonth]);

  const goToMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const goToToday = () => {
    const today = new Date();
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setSelectedKey(dayKey(today));
  };

  if (!user) {
    return null; // Will redirect to signin
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 mobile-page">
        <div className="space-y-4">
          <div className="skeleton h-9 w-56 rounded-xl" />
          <div className="skeleton h-[420px] rounded-3xl" />
          <div className="skeleton h-28 rounded-3xl" />
        </div>
      </div>
    );
  }

  const now = Date.now();
  const todayKey = dayKey(new Date());
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const selectedDate = dateFromKey(selectedKey);
  const selectedEvents = eventsByDay.get(selectedKey) ?? [];
  const selectedLabel = selectedDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

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
          Event <span className="text-gradient">Calendar</span>
        </h1>
        <p className="text-base sm:text-lg text-muted font-light">
          Betting deadlines across all your groups
        </p>
      </div>

      {events.length === 0 ? (
        <div className="glass rounded-3xl text-center py-14 px-6 animate-fade-in">
          <p className="text-muted mb-5 font-light">No events yet.</p>
          <Link href="/create" className="btn-primary">
            Create Event
          </Link>
        </div>
      ) : (
        <>
          <div className="glass rounded-3xl p-3 sm:p-6">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 sm:mb-5">
              <h2 className="font-display text-xl sm:text-2xl font-semibold text-foreground">
                {monthLabel}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToMonth(-1)}
                  aria-label="Previous month"
                  className="no-min-size inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-muted hover:text-foreground hover:bg-white/10 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={goToToday}
                  className="no-min-size inline-flex h-9 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 text-sm font-medium text-muted hover:text-foreground hover:bg-white/10 transition-colors"
                >
                  Today
                </button>
                <button
                  onClick={() => goToMonth(1)}
                  aria-label="Next month"
                  className="no-min-size inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-muted hover:text-foreground hover:bg-white/10 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Weekday header */}
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-1 sm:mb-1.5">
              {WEEKDAYS.map((day) => (
                <div
                  key={day}
                  className="text-center text-[11px] sm:text-xs font-semibold uppercase tracking-wide text-muted-2 py-1"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Month grid */}
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {cells.map((date) => {
                const key = dayKey(date);
                const inMonth = date.getMonth() === viewMonth;
                const isToday = key === todayKey;
                const isSelected = key === selectedKey;
                const dayEvents = eventsByDay.get(key) ?? [];

                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    aria-label={date.toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                    onClick={() => setSelectedKey(key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedKey(key);
                      }
                    }}
                    className={`cursor-pointer rounded-xl sm:rounded-2xl border p-1 sm:p-1.5 min-h-[56px] sm:min-h-[104px] transition-colors ${
                      isSelected
                        ? 'border-brand-2/60 bg-white/[0.07]'
                        : isToday
                          ? 'border-brand-2/40 bg-white/[0.04]'
                          : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]'
                    } ${inMonth ? '' : 'opacity-40'}`}
                  >
                    <span
                      className={`inline-flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full text-[11px] sm:text-xs font-semibold tabular-nums ${
                        isToday
                          ? 'bg-brand-2/20 text-brand-2 ring-1 ring-brand-2/40'
                          : inMonth
                            ? 'text-foreground/80'
                            : 'text-muted-2'
                      }`}
                    >
                      {date.getDate()}
                    </span>

                    {/* Event chips — desktop/tablet */}
                    {dayEvents.length > 0 && (
                      <div className="hidden sm:flex flex-col gap-1 mt-1 min-w-0">
                        {dayEvents.slice(0, 3).map((event) => (
                          <Link
                            key={event.id}
                            href={`/events/${event.id}`}
                            onClick={(e) => e.stopPropagation()}
                            title={event.title}
                            className={`no-min-size block truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 transition-opacity hover:opacity-80 ${
                              stateChipClasses[getEventState(event, now)]
                            }`}
                          >
                            {event.title}
                          </Link>
                        ))}
                        {dayEvents.length > 3 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedKey(key);
                            }}
                            className="no-min-size text-left text-[11px] font-medium text-muted-2 hover:text-foreground transition-colors px-1.5"
                          >
                            +{dayEvents.length - 3} more
                          </button>
                        )}
                      </div>
                    )}

                    {/* Event dots — mobile */}
                    {dayEvents.length > 0 && (
                      <div className="flex sm:hidden flex-wrap items-center gap-0.5 mt-1">
                        {dayEvents.slice(0, 4).map((event) => (
                          <span
                            key={event.id}
                            className={`h-1.5 w-1.5 rounded-full ${
                              stateDotClasses[getEventState(event, now)]
                            }`}
                          />
                        ))}
                        {dayEvents.length > 4 && (
                          <span className="text-[9px] leading-none text-muted-2">
                            +{dayEvents.length - 4}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-neon-mint" /> Live
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-neon-amber" /> Awaiting resolution
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-muted-2" /> Resolved
              </span>
            </div>
          </div>

          {/* Selected day detail */}
          <div key={selectedKey} className="glass rounded-3xl p-5 sm:p-6 mt-4 animate-fade-in">
            <h3 className="font-display text-lg sm:text-xl font-semibold text-foreground mb-1">
              {selectedLabel}
            </h3>
            {selectedEvents.length === 0 ? (
              <p className="text-sm text-muted font-light">No events on this day.</p>
            ) : (
              <div className="space-y-2.5 mt-3">
                {selectedEvents.map((event) => {
                  const state = getEventState(event, now);
                  return (
                    <Link
                      key={event.id}
                      href={`/events/${event.id}`}
                      className="glass-subtle group flex items-center justify-between gap-3 rounded-2xl p-3.5 hover:border-white/[0.14] transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate group-hover:text-gradient transition-colors">
                          {event.title}
                        </div>
                        <div className="text-xs text-muted-2 mt-0.5 truncate">
                          {event.group_name} ·{' '}
                          {new Date(event.end_time).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                      <span className={`chip flex-shrink-0 ${stateChipClasses[state]}`}>
                        {stateLabels[state]}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
