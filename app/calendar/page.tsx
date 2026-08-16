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

// Tone-system mapping — live = tone-yes, awaiting resolution = tone-pending, resolved = tone-neutral.
const stateTone: Record<EventState, string> = {
  ongoing: 'tone-yes',
  ended: 'tone-pending',
  resolved: 'tone-neutral',
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
      <div className="page-shell mobile-page">
        <div className="skeleton-line mb-2 h-8 w-56" />
        <div className="skeleton-line mb-8 h-4 w-72" />
        <div className="skeleton h-[420px] rounded-[var(--radius-panel)]" />
        <div className="skeleton mt-4 h-28 rounded-[var(--radius-panel)]" />
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
    <div className="page-shell mobile-page animate-rise">
      <div className="mb-8">
        <Link
          href="/"
          className="press mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-foreground"
        >
          ← Back to Groups
        </Link>
        <p className="eyebrow mb-2">Schedule</p>
        <h1 className="display-1 mb-2">Event Calendar</h1>
        <p className="lede">Betting deadlines across all your groups.</p>
      </div>

      {events.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="empty-state-title">No events yet</p>
          <p className="empty-state-body">
            Events you create or join will show up on this calendar by their betting deadline.
          </p>
          <Link href="/create" className="btn-primary">
            Create Event
          </Link>
        </div>
      ) : (
        <>
          <div className="card p-3 sm:p-6">
            {/* Toolbar */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-5">
              <h2 className="display-3">{monthLabel}</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToMonth(-1)}
                  aria-label="Previous month"
                  className="btn-glass no-min-size h-9 w-9 p-0"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={goToToday}
                  aria-label="Go to current month and select today"
                  className="btn-glass no-min-size h-9 px-4 text-sm"
                >
                  Today
                </button>
                <button
                  onClick={() => goToMonth(1)}
                  aria-label="Next month"
                  className="btn-glass no-min-size h-9 w-9 p-0"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Weekday header */}
            <div className="mb-1 grid grid-cols-7 gap-1 sm:mb-1.5 sm:gap-1.5">
              {WEEKDAYS.map((day) => (
                <div key={day} className="eyebrow py-1 text-center">
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
                    aria-pressed={isSelected}
                    aria-label={`${date.toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}${isToday ? ' (today)' : ''}${isSelected ? ' (selected)' : ''}`}
                    onClick={() => setSelectedKey(key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedKey(key);
                      }
                    }}
                    className={`relative min-h-[56px] cursor-pointer rounded-lg border p-1 transition-colors sm:min-h-[104px] sm:rounded-xl sm:p-1.5 ${
                      isSelected
                        ? 'tone-accent tone-surface border-2'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-sunken)]'
                    } ${inMonth ? '' : 'opacity-45'}`}
                  >
                    {isSelected && (
                      <span
                        className="tone-dot tone-accent absolute right-1.5 top-1.5"
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums sm:h-6 sm:w-6 sm:text-xs ${
                        isToday
                          ? 'bg-[var(--color-accent)] text-white'
                          : inMonth
                            ? 'text-foreground'
                            : 'text-muted'
                      } ${isSelected && !isToday ? 'font-bold' : ''}`}
                    >
                      {date.getDate()}
                    </span>

                    {/* Event chips — desktop/tablet */}
                    {dayEvents.length > 0 && (
                      <div className="mt-1 hidden min-w-0 flex-col gap-1 sm:flex">
                        {dayEvents.slice(0, 3).map((event) => {
                          const tone = stateTone[getEventState(event, now)];
                          return (
                            <Link
                              key={event.id}
                              href={`/events/${event.id}`}
                              onClick={(e) => e.stopPropagation()}
                              title={event.title}
                              className={`${tone} tone-surface tone-text no-min-size block truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 transition-opacity hover:opacity-80`}
                            >
                              {event.title}
                            </Link>
                          );
                        })}
                        {dayEvents.length > 3 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedKey(key);
                            }}
                            className="no-min-size px-1.5 text-left text-[11px] font-medium text-muted transition-colors hover:text-foreground"
                          >
                            +{dayEvents.length - 3} more
                          </button>
                        )}
                      </div>
                    )}

                    {/* Event dots — mobile */}
                    {dayEvents.length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-0.5 sm:hidden">
                        {dayEvents.slice(0, 4).map((event) => (
                          <span
                            key={event.id}
                            className={`${stateTone[getEventState(event, now)]} tone-dot`}
                          />
                        ))}
                        {dayEvents.length > 4 && (
                          <span className="text-[9px] leading-none text-muted">
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
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
              {(['ongoing', 'ended', 'resolved'] as EventState[]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className={`${stateTone[s]} tone-dot`} /> {stateLabels[s]}
                </span>
              ))}
            </div>
          </div>

          {/* Selected day detail */}
          <div key={selectedKey} className="card animate-sheet mt-4 p-5 sm:p-6">
            <div className="section-head mb-3">
              <span className="eyebrow">{selectedLabel}</span>
            </div>
            {selectedEvents.length === 0 ? (
              <p className="text-sm text-muted">No events on this day.</p>
            ) : (
              <div className="space-y-2.5">
                {selectedEvents.map((event) => {
                  const state = getEventState(event, now);
                  const tone = stateTone[state];
                  return (
                    <Link
                      key={event.id}
                      href={`/events/${event.id}`}
                      className="card-interactive press flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] p-3.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{event.title}</div>
                        <div className="mt-0.5 truncate text-xs text-muted">
                          {event.group_name} ·{' '}
                          {new Date(event.end_time).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                      <span className={`${tone} pill flex-none`}>{stateLabels[state]}</span>
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
