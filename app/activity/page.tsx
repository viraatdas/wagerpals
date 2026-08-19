
'use client';
export const dynamic = 'force-dynamic';


import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useUser } from '@stackframe/stack';
import { useRouter } from 'next/navigation';
import { ActivityItem } from '@/lib/types';
import { formatTimestamp, handle } from '@/lib/utils';
import { formatW } from '@/lib/odds';
import AvatarStack from '@/components/AvatarStack';
import EmptySlip from '@/components/EmptySlip';

type ActivityTone = 'tone-accent' | 'tone-yes' | 'tone-info' | 'tone-neutral';

function toneForActivity(type: ActivityItem['type']): ActivityTone {
  switch (type) {
    case 'bet':
      return 'tone-accent';
    case 'resolution':
      return 'tone-yes';
    case 'event_created':
      return 'tone-info';
    case 'comment':
    default:
      return 'tone-neutral';
  }
}

// Presentation-only day bucketing off the timestamp we already have.
function dayLabel(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function activityLine(activity: ActivityItem): { primary: ReactNode; secondary?: string } {
  const name = <span className="font-medium text-foreground">{handle(activity.username || 'Unknown')}</span>;
  const title = <span className="text-muted">&ldquo;{activity.event_title}&rdquo;</span>;
  const groupSuffix = activity.group_name ? (
    <span className="text-muted"> &middot; {activity.group_name}</span>
  ) : null;

  if (activity.type === 'bet') {
    return {
      primary: (
        <>
          {name} bet on <span className="font-medium text-foreground">{activity.side}</span> in {title}
          {groupSuffix}
        </>
      ),
      secondary: activity.note,
    };
  }

  if (activity.type === 'event_created') {
    return {
      primary: (
        <>
          {name} created {title}
          {groupSuffix}
        </>
      ),
    };
  }

  if (activity.type === 'resolution') {
    return {
      primary: (
        <>
          <span className="font-medium text-foreground">Resolved</span> {title} &mdash; winner{' '}
          <span className="tone-text font-medium">{activity.winning_side}</span>
          {groupSuffix}
        </>
      ),
    };
  }

  if (activity.type === 'comment') {
    return {
      primary: (
        <>
          {name} commented on {title}
          {groupSuffix}
        </>
      ),
      secondary: activity.content || activity.note,
    };
  }

  return { primary: `Unknown activity type: ${activity.type}` };
}

function ActivityRow({ activity }: { activity: ActivityItem }) {
  const tone = toneForActivity(activity.type);
  const { primary, secondary } = activityLine(activity);
  const actor = { username: activity.username || 'Unknown' };

  return (
    <Link
      href={`/events/${activity.event_id}`}
      className={`${tone} press flex items-start gap-3 border-b border-[var(--color-border)] px-3 py-3 transition-colors last:border-b-0 hover:bg-[var(--color-surface-sunken)] sm:px-4`}
    >
      <AvatarStack people={[actor]} size="sm" className="mt-0.5 flex-none" />
      <div className="min-w-0 flex-1">
        <p className="font-sans text-sm leading-snug text-foreground break-words">{primary}</p>
        {secondary && (
          <p className="mt-0.5 truncate font-sans text-xs italic text-muted">&ldquo;{secondary}&rdquo;</p>
        )}
      </div>
      <div className="flex flex-none flex-col items-end gap-0.5 pl-1 text-right">
        {activity.type === 'bet' && typeof activity.amount === 'number' && (
          <span className="numeral tone-text text-sm">
            {activity.payment_type === 'cash'
              ? `$${activity.amount.toFixed(2)}`
              : formatW(activity.amount)}
          </span>
        )}
        <span className="whitespace-nowrap font-mono text-xs text-muted">{formatTimestamp(activity.timestamp)}</span>
      </div>
    </Link>
  );
}

// Presentation-only grouping of the already-fetched, already-ordered list.
function groupByDay(activities: ActivityItem[]): { key: string; label: string; items: ActivityItem[] }[] {
  const groups: { key: string; label: string; items: ActivityItem[] }[] = [];
  for (const activity of activities) {
    const key = dayKey(activity.timestamp);
    const current = groups[groups.length - 1];
    if (current && current.key === key) {
      current.items.push(activity);
    } else {
      groups.push({ key, label: dayLabel(activity.timestamp), items: [activity] });
    }
  }
  return groups;
}

function ActivitySkeletonRows() {
  return (
    <div className="card overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 border-b border-[var(--color-border)] px-3 py-3 last:border-b-0 sm:px-4">
          <span className="skeleton mt-1.5 h-2 w-2 flex-none rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton-line w-3/4" />
            <div className="skeleton-line w-1/3" />
          </div>
          <div className="skeleton-line w-14 flex-none" />
        </div>
      ))}
    </div>
  );
}

export default function ActivityPage() {
  const user = useUser({ or: "return-null" });
  const router = useRouter();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
      return;
    }
    fetchActivities();
  }, [user, router]);

  const fetchActivities = async () => {
    if (!user) return;

    try {
      const response = await fetch(`/api/activity?userId=${user.id}`);
      const data = await response.json();
      setActivities(data);
    } catch (error) {
      console.error('[Activity] Failed to fetch activities:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-shell-narrow mobile-page">
        <div className="skeleton-line mb-2 h-8 w-56" />
        <div className="skeleton-line mb-8 h-4 w-72" />
        <ActivitySkeletonRows />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const groups = groupByDay(activities);

  return (
    <div className="page-shell-narrow mobile-page animate-rise">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="eyebrow">Ledger</p>
        <Link
          href="/calendar"
          className="press font-sans text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          View calendar →
        </Link>
      </div>
      <h1 className="display-1 mb-2">History</h1>
      <p className="lede mb-8">
        Recent events, bets, and resolutions from your groups.
      </p>

      {activities.length === 0 ? (
        <EmptySlip
          headline="Nothing's happened yet."
          body="Bets, comments, and resolutions land here as they happen."
          action={{ label: 'Create an event', href: '/create' }}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="section-head mb-2">
                <span className="eyebrow">{group.label}</span>
              </div>
              <div className="card stagger-rows overflow-hidden">
                {group.items.map((activity, index) => (
                  <ActivityRow
                    key={`${activity.type}-${activity.event_id}-${activity.timestamp}-${index}`}
                    activity={activity}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="pt-2 text-center text-xs text-muted">
            Showing {activities.length} {activities.length === 50 ? '(limit reached)' : ''} activities from your groups
          </div>
        </div>
      )}
    </div>
  );
}
