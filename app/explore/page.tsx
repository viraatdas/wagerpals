'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import EmptySlip from '@/components/EmptySlip';
import { Group } from '@/lib/types';

// Public group discovery — the Board's group-chip row only ever shows groups
// the caller already belongs to (see IA-DECISIONS.md), so this page is the
// one place to find and join a public group without an invite code. It
// drives GET /api/groups?public=true, an existing, deliberately-anonymous
// endpoint (see the "group membership is the read boundary" invariant in
// CLAUDE.md) that returns public groups with member/admin counts only —
// never a roster. Not previously wired up to any page in the app.

interface PublicGroup extends Group {
  member_count: number;
  admin_count: number;
}

type SortKey = 'members' | 'new';

export default function Explore() {
  const [groups, setGroups] = useState<PublicGroup[]>([]);
  const [sort, setSort] = useState<SortKey>('members');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPublicGroups();
  }, []);

  const fetchPublicGroups = async () => {
    try {
      const response = await fetch('/api/groups?public=true');
      const data = await response.json();
      setGroups(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch public groups:', error);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  };

  const sortedGroups = [...groups].sort((a, b) => {
    if (sort === 'members') return b.member_count - a.member_count;
    return (b.created_at ? Date.parse(b.created_at) : 0) - (a.created_at ? Date.parse(a.created_at) : 0);
  });

  const sorts: { key: SortKey; label: string }[] = [
    { key: 'members', label: 'Most members' },
    { key: 'new', label: 'Newest' },
  ];

  const chipClass = (active: boolean) =>
    `shrink-0 whitespace-nowrap rounded-chip px-3 py-1.5 font-sans text-sm font-medium transition-colors duration-fast ${
      active
        ? 'bg-emerald text-on-emerald'
        : 'border border-line bg-card text-ink-secondary hover:border-ink-secondary'
    }`;

  if (loading) {
    return (
      <div className="page-shell mobile-page">
        <div className="skeleton h-9 w-52 rounded-control mb-6" />
        <div className="mb-6 flex gap-2">
          <div className="skeleton h-9 w-32 rounded-chip" />
          <div className="skeleton h-9 w-24 rounded-chip" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-32 rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell mobile-page">
      <div className="mb-6">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="font-display text-2xl text-ink sm:text-3xl">Explore groups</h1>
          {sortedGroups.length > 0 && (
            <span className="font-mono text-lg font-medium text-emerald">{sortedGroups.length}</span>
          )}
        </div>
        <p className="mt-2 font-sans text-sm text-ink-secondary">
          Public groups anyone can join. No invite code needed.
        </p>
      </div>

      {sortedGroups.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {sorts.map(({ key, label }) => (
            <button key={key} onClick={() => setSort(key)} className={chipClass(sort === key)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {sortedGroups.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedGroups.map((group) => (
            <Link
              key={group.id}
              href={`/groups/${group.id}`}
              className="block rounded-card border border-line bg-card p-5 shadow-elev-1 transition-all duration-base ease-out-expo hover:-translate-y-0.5 hover:shadow-elev-2"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 truncate font-sans text-base font-medium text-ink">{group.name}</h3>
                <span className="shrink-0 rounded-pill border border-line bg-card px-2.5 py-0.5 font-mono text-xs uppercase tracking-wide text-ink-secondary">
                  Public
                </span>
              </div>
              <p className="mt-0.5 font-mono text-xs text-ink-muted">#{group.id}</p>

              <div className="mt-4 flex items-center gap-5">
                <div>
                  <div className="font-mono text-2xl font-medium text-amber-ink">{group.member_count}</div>
                  <div className="font-sans text-xs text-ink-muted">
                    {group.member_count === 1 ? 'member' : 'members'}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-medium text-amber-ink">{group.admin_count}</div>
                  <div className="font-sans text-xs text-ink-muted">
                    {group.admin_count === 1 ? 'admin' : 'admins'}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptySlip
          headline="No public groups yet."
          body="Start one from the Board, or check back soon."
          action={{ label: 'Go to Board', href: '/' }}
        />
      )}
    </div>
  );
}
