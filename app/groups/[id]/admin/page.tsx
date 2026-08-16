'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import Toast, { ToastType } from '@/components/Toast';

export const dynamic = 'force-dynamic';

export default function GroupAdminPage() {
  const params = useParams();
  const router = useRouter();
  const user = useUser({ or: "return-null" });
  const [group, setGroup] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
      return;
    }
    fetchGroup(user.id);
  }, [params.id, user, router]);

  const fetchGroup = async (uid: string) => {
    try {
      const response = await fetch(`/api/groups?id=${params.id}`);
      if (!response.ok) throw new Error('Failed to fetch group');
      const data = await response.json();

      // Check if user is admin. Non-members get no roster at all from the
      // API, so the lookup simply comes up empty and they get bounced.
      const userMember = (data.members || []).find((m: any) => m.user_id === uid);
      if (userMember?.role !== 'admin') {
        router.push(`/groups/${params.id}`);
        return;
      }

      setGroup(data);
    } catch (error) {
      console.error('Failed to fetch group:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMemberAction = async (action: string, targetUserId: string) => {
    if (!user) return;

    setProcessing(true);
    try {
      const response = await fetch('/api/groups/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          group_id: params.id,
          target_user_id: targetUserId,
          admin_user_id: user.id,
        }),
      });

      if (response.ok) {
        setToast({ message: 'Action completed successfully', type: 'success' });
        fetchGroup(user.id);
      } else {
        const data = await response.json();
        setToast({ message: data.error || 'Failed to perform action', type: 'error' });
      }
    } catch (error) {
      console.error('Failed to perform action:', error);
      setToast({ message: 'Failed to perform action', type: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const handleGroupSettings = async (settings: { resolver_user_id?: string; is_public?: boolean }) => {
    if (!user) return;

    setProcessing(true);
    try {
      const response = await fetch('/api/groups', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: params.id,
          ...settings,
        }),
      });

      if (response.ok) {
        setToast({ message: 'Group settings updated', type: 'success' });
        fetchGroup(user.id);
      } else {
        const data = await response.json();
        setToast({ message: data.error || 'Failed to update group settings', type: 'error' });
      }
    } catch (error) {
      console.error('Failed to update group settings:', error);
      setToast({ message: 'Failed to update group settings', type: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!user) return;
    if (!confirm(`Delete ${group.name}? This removes the group and all of its events, bets, and comments.`)) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/groups?id=${params.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        router.push('/');
      } else {
        const data = await response.json();
        setToast({ message: data.error || 'Failed to delete group', type: 'error' });
      }
    } catch (error) {
      console.error('Failed to delete group:', error);
      setToast({ message: 'Failed to delete group', type: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  if (!user) {
    return null; // Will redirect to signin
  }

  if (loading) {
    return (
      <div className="page-shell mobile-page">
        <div className="space-y-4 mb-8">
          <div className="skeleton h-3 w-24 rounded-full" />
          <div className="skeleton h-9 w-1/2 rounded-xl" />
        </div>
        <div className="skeleton h-32 rounded-2xl mb-8" />
        <div className="skeleton h-40 rounded-2xl" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="page-shell mobile-page">
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="empty-state-title">Group not found</p>
          <p className="empty-state-body">This group may have been deleted, or the link is incorrect.</p>
          <Link href="/" className="btn-primary press">Go home</Link>
        </div>
      </div>
    );
  }

  const pendingRequests: any[] = Array.isArray(group.pending_requests) ? group.pending_requests : [];
  const members: any[] = Array.isArray(group.members) ? group.members : [];

  return (
    <>
      <Toast
        isOpen={toast !== null}
        onClose={() => setToast(null)}
        message={toast?.message || ''}
        type={toast?.type || 'info'}
      />
      <div className="page-shell mobile-page animate-rise">
        <div className="mb-8">
          <Link
            href={`/groups/${params.id}`}
            className="press inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-foreground transition-colors mb-3"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to group
          </Link>
          <span className="eyebrow block mb-2">
            Group <span className="font-mono normal-case tracking-normal">{group.id}</span>
          </span>
          <h1 className="display-2 break-words">{group.name}</h1>
        </div>

        {/* Focal point: pending join requests */}
        {pendingRequests.length > 0 ? (
          <section className="card rail-top tone-pending p-5 sm:p-6 mb-10">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="eyebrow tone-text">Pending requests</span>
              <span className="pill tone-pending pill-solid">{pendingRequests.length}</span>
            </div>
            <p className="text-sm text-muted mb-5">
              These people asked to join {group.name}. Approve to let them in, or decline to turn them away.
            </p>
            <ul className="divide-y divide-hairline stagger-rows">
              {pendingRequests.map((member: any) => (
                <li
                  key={member.user_id}
                  className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{member.username}</p>
                    <p className="text-xs text-muted">
                      Requested {new Date(member.joined_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <button
                      onClick={() => handleMemberAction('approve', member.user_id)}
                      disabled={processing}
                      aria-label={`Approve ${member.username}`}
                      className="btn-quiet-success press disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleMemberAction('decline', member.user_id)}
                      disabled={processing}
                      aria-label={`Decline ${member.username}`}
                      className="btn-quiet-danger press disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="empty-state mb-10">
            <div className="empty-state-icon">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="empty-state-title">No pending requests</p>
            <p className="empty-state-body">Nobody is waiting to join right now. Invite more people to grow the group.</p>
            <Link href={`/groups/${params.id}`} className="btn-primary press">Invite more people</Link>
          </div>
        )}

        <section className="mb-10">
          <div className="section-head mb-5">
            <span className="eyebrow">Group settings</span>
          </div>
          <div className="card p-5 sm:p-6 space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  Status: <span className="font-semibold text-foreground">{group.is_public ? 'Free points' : 'Paid wallet betting'}</span>
                </p>
                <p className="text-sm text-muted">
                  Paid groups require wallet funds before members can place bets.
                </p>
              </div>
              <button
                onClick={() => handleGroupSettings({ is_public: !group.is_public })}
                disabled={processing}
                className="btn-primary press w-full sm:w-auto text-sm disabled:opacity-50"
              >
                {group.is_public ? 'Enable paid betting' : 'Use free points'}
              </button>
            </div>

            {!group.is_public && (
              <div className="pt-1 border-t border-hairline">
                <p className="text-sm text-foreground mt-4 mb-3">
                  Resolver: <span className="font-semibold text-foreground">@{group.resolver?.username || 'Not set'}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {members.map((member: any) => {
                    const isResolver = group.resolver?.user_id === member.user_id;
                    return (
                      <button
                        key={member.user_id}
                        onClick={() => handleGroupSettings({ resolver_user_id: member.user_id })}
                        disabled={processing || isResolver}
                        aria-label={isResolver ? `${member.username} is the current resolver` : `Make ${member.username} the resolver`}
                        className={`press pill disabled:cursor-not-allowed ${isResolver ? 'pill-solid tone-accent' : 'tone-neutral'}`}
                      >
                        @{member.username}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="mb-10">
          <div className="section-head mb-5">
            <span className="eyebrow">Members ({members.length})</span>
          </div>
          {members.length > 0 ? (
            <div className="card overflow-hidden">
              <ul className="divide-y divide-hairline stagger-rows">
                {members.map((member: any) => (
                  <li
                    key={member.user_id}
                    className="flex flex-col gap-3 px-4 py-4 sm:px-5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-sunken text-xs font-semibold text-muted">
                        {(member.username || '?').trim().charAt(0).toUpperCase() || '?'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{member.username}</p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          {member.role === 'admin' && <span className="pill tone-accent">Admin</span>}
                          {member.user_id === group.created_by && <span className="pill tone-info">Creator</span>}
                          {member.role !== 'admin' && member.user_id !== group.created_by && (
                            <span className="text-xs text-muted">Member</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {member.user_id !== group.created_by && member.user_id !== user.id && (
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row shrink-0">
                        {member.role === 'member' ? (
                          <button
                            onClick={() => handleMemberAction('promote', member.user_id)}
                            disabled={processing}
                            aria-label={`Promote ${member.username} to admin`}
                            className="btn-glass press text-sm disabled:opacity-50"
                          >
                            Promote to admin
                          </button>
                        ) : (
                          <button
                            onClick={() => handleMemberAction('demote', member.user_id)}
                            disabled={processing}
                            aria-label={`Demote ${member.username} to member`}
                            className="btn-glass press text-sm disabled:opacity-50"
                          >
                            Demote to member
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (confirm(`Remove ${member.username} from the group?`)) {
                              handleMemberAction('remove', member.user_id);
                            }
                          }}
                          disabled={processing}
                          aria-label={`Remove ${member.username} from group`}
                          className="btn-quiet-danger press disabled:opacity-50"
                        >
                          Remove from group
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-3.998-4.2" />
                </svg>
              </div>
              <p className="empty-state-title">No members yet</p>
              <p className="empty-state-body">Invite people to this group to see them here.</p>
              <Link href={`/groups/${params.id}`} className="btn-primary press">Invite more people</Link>
            </div>
          )}
        </section>

        {user.id === group.created_by && (
          <section className="card tone-no rail p-5 sm:p-6">
            <p className="eyebrow tone-text mb-2">Danger zone</p>
            <h2 className="text-lg font-display font-semibold text-foreground mb-2">Delete group</h2>
            <p className="text-sm text-muted mb-4">
              This permanently removes the group, events, bets, comments, and memberships. This cannot be undone.
            </p>
            <button
              onClick={handleDeleteGroup}
              disabled={deleting}
              className="btn-danger press disabled:opacity-50"
            >
              {deleting ? 'Deleting group…' : 'Delete this group'}
            </button>
          </section>
        )}
      </div>
    </>
  );
}
