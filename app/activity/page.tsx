
'use client';
export const dynamic = 'force-dynamic';


import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@stackframe/stack';
import { useRouter } from 'next/navigation';
import { ActivityItem } from '@/lib/types';
import { formatTimestamp } from '@/lib/utils';

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

  const renderActivity = (activity: ActivityItem, index: number) => {
    if (activity.type === 'bet') {
      return (
        <div className="flex justify-between items-start">
          <span className="mt-1.5 mr-3 h-2 w-2 flex-shrink-0 rounded-full bg-sky-500" />
          <div className="flex-1">
            <p className="text-foreground">
              <span className="font-medium text-sky-700">@{activity.username || 'Unknown'}</span>
              {' bet '}
              <span className="font-semibold text-foreground">${activity.amount?.toFixed(2)}</span>
              {' on '}
              <span className="font-medium">{activity.side}</span>
              {' in '}
              <span className="text-muted">"{activity.event_title}"</span>
              {activity.group_name && (
                <>
                  {' '}
                  <span className="text-muted-2 text-sm">
                    · <span className="font-medium">{activity.group_name}</span>
                  </span>
                </>
              )}
            </p>
            {activity.note && (
              <p className="text-sm text-muted mt-1 italic">
                "{activity.note}"
              </p>
            )}
          </div>
          <span className="text-xs text-muted-2 ml-2 whitespace-nowrap">
            {formatTimestamp(activity.timestamp)}
          </span>
        </div>
      );
    }

    if (activity.type === 'event_created') {
      return (
        <div className="flex justify-between items-start">
          <span className="mt-1.5 mr-3 h-2 w-2 flex-shrink-0 rounded-full bg-indigo-500" />
          <div>
            <p className="text-foreground">
              <span className="font-medium text-indigo-600">@{activity.username || 'Unknown'}</span>
              {' created '}
              <span className="text-muted">"{activity.event_title}"</span>
              {activity.group_name && (
                <>
                  {' '}
                  <span className="text-muted-2 text-sm">
                    · <span className="font-medium">{activity.group_name}</span>
                  </span>
                </>
              )}
            </p>
          </div>
          <span className="text-xs text-muted-2 ml-2 whitespace-nowrap">
            {formatTimestamp(activity.timestamp)}
          </span>
        </div>
      );
    }

    if (activity.type === 'resolution') {
      return (
        <div className="flex justify-between items-start">
          <span className="mt-1.5 mr-3 h-2 w-2 flex-shrink-0 rounded-full bg-green-500" />
          <div>
            <p className="text-foreground">
              <span className="font-medium text-green-700">✓ Resolved:</span>
              {' '}
              <span className="text-muted">"{activity.event_title}"</span>
              {activity.group_name && (
                <>
                  {' '}
                  <span className="text-muted-2 text-sm">
                    · <span className="font-medium">{activity.group_name}</span>
                  </span>
                </>
              )}
            </p>
            <p className="text-sm text-muted mt-1">
              Winner: <span className="font-medium text-green-700">{activity.winning_side}</span>
            </p>
          </div>
          <span className="text-xs text-muted-2 ml-2 whitespace-nowrap">
            {formatTimestamp(activity.timestamp)}
          </span>
        </div>
      );
    }

    if (activity.type === 'comment') {
      return (
        <div className="flex justify-between items-start">
          <span className="mt-1.5 mr-3 h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" />
          <div className="flex-1">
            <p className="text-foreground">
              <span className="font-medium text-amber-700">@{activity.username || 'Unknown'}</span>
              {' commented on '}
              <span className="text-muted">"{activity.event_title}"</span>
              {activity.group_name && (
                <>
                  {' '}
                  <span className="text-muted-2 text-sm">
                    · <span className="font-medium">{activity.group_name}</span>
                  </span>
                </>
              )}
            </p>
            {(activity.content || activity.note) && (
              <p className="text-sm text-muted mt-1 italic">
                "{activity.content || activity.note}"
              </p>
            )}
          </div>
          <span className="text-xs text-muted-2 ml-2 whitespace-nowrap">
            {formatTimestamp(activity.timestamp)}
          </span>
        </div>
      );
    }

    return (
      <div className="text-muted-2">
        Unknown activity type: {activity.type}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 mobile-page">
        <div className="h-9 w-48 skeleton rounded-xl mb-2" />
        <div className="h-5 w-72 skeleton rounded-lg mb-8" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 skeleton rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 mobile-page animate-rise">
      <h1 className="font-display text-3xl font-semibold text-foreground mb-2">
        Activity Feed
      </h1>
      <p className="text-muted mb-8">
        Recent events, bets, and resolutions from your groups
      </p>

      {activities.length === 0 ? (
        <div className="glass-subtle rounded-3xl p-12 text-center">
          <p className="text-foreground text-lg mb-2">No activity yet</p>
          <p className="text-muted text-sm">
            Start by creating an event and placing bets!
          </p>
        </div>
      ) : (
        <div className="space-y-3 stagger">
          {activities.map((activity, index) => (
            <Link
              key={`${activity.type}-${activity.event_id}-${activity.timestamp}-${index}`}
              href={`/events/${activity.event_id}`}
            >
              <div className="glass glass-hover rounded-2xl p-4 cursor-pointer">
                {renderActivity(activity, index)}
              </div>
            </Link>
          ))}

          <div className="text-center text-xs text-muted-2 pt-4">
            Showing {activities.length} {activities.length === 50 ? '(limit reached)' : ''} activities from your groups
          </div>
        </div>
      )}
    </div>
  );
}
