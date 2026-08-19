'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import Toast, { ToastType } from '@/components/Toast';
import AvatarStack from '@/components/AvatarStack';
import EmptySlip from '@/components/EmptySlip';
import { handle } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// R3: flat groups have no admin role — moderation (rename, kick, delete) is
// creator-only, and this whole route is the "Manage" surface for that. GET
// /api/groups?id= already computes `is_admin` as "is the group creator"
// server-side; this page just reads it, it never re-derives it from a
// member's `role`.
export default function GroupManagePage() {
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
    fetchGroup();
  }, [params.id, user, router]);

  const fetchGroup = async () => {
    try {
      const response = await fetch(`/api/groups?id=${params.id}`);
      if (!response.ok) throw new Error('Failed to fetch group');
      const data = await response.json();
      setGroup(data);
    } catch (error) {
      console.error('Failed to fetch group:', error);
    } finally {
      setLoading(false);
    }
  };

  const MEMBER_ACTION_SUCCESS: Record<string, (username: string) => string> = {
    approve: (username) => `${handle(username)} is in`,
    decline: () => 'Request declined',
    remove: (username) => `${handle(username)} removed`,
  };

  const handleMemberAction = async (action: string, targetUserId: string, targetUsername: string) => {
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
        const successText = MEMBER_ACTION_SUCCESS[action]?.(targetUsername) ?? `${handle(targetUsername)} updated`;
        setToast({ message: successText, type: 'success' });
        fetchGroup();
      } else {
        const data = await response.json();
        setToast({ message: data.error || `Couldn't update ${handle(targetUsername)}. Try again.`, type: 'error' });
      }
    } catch (error) {
      console.error('Failed to perform action:', error);
      setToast({ message: `Couldn't update ${handle(targetUsername)}. Try again.`, type: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const handleGroupSettings = async (
    settings: { is_public?: boolean },
    successMessage: string = 'Group settings updated'
  ) => {
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
        setToast({ message: successMessage, type: 'success' });
        fetchGroup();
      } else {
        const data = await response.json();
        setToast({ message: data.error || "Couldn't update the group. Try again.", type: 'error' });
      }
    } catch (error) {
      console.error('Failed to update group settings:', error);
      setToast({ message: "Couldn't update the group. Try again.", type: 'error' });
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
        setToast({ message: data.error || "Couldn't delete the group. Try again.", type: 'error' });
      }
    } catch (error) {
      console.error('Failed to delete group:', error);
      setToast({ message: "Couldn't delete the group. Try again.", type: 'error' });
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
        <EmptySlip
          headline="Group not found"
          body="This group is gone, or the link's wrong."
          action={{ label: 'Go home', href: '/' }}
        />
      </div>
    );
  }

  // R3: this whole route is creator-only. Everyone else — including other
  // active members — gets a product-voice "not yours" state instead of the
  // management UI, rather than a silent redirect away.
  if (!group.is_admin) {
    return (
      <div className="page-shell mobile-page">
        <EmptySlip
          headline="This one's not yours to manage."
          body={`Only the person who started ${group.name || 'this group'} can manage it.`}
          action={{ label: 'Back to group', href: `/groups/${params.id}` }}
        />
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
            Manage <span className="font-mono normal-case tracking-normal">{group.id}</span>
          </span>
          <h1 className="display-2 break-words">{group.name}</h1>
        </div>

        {/* Legacy-only: pending join requests from before joins became
            instant (R3). New joins never create these — this section simply
            doesn't render once the payload has none left. */}
        {pendingRequests.length > 0 && (
          <section className="card rail-top tone-pending p-5 sm:p-6 mb-10">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="eyebrow tone-text">Pending requests</span>
              <span className="pill tone-pending pill-solid">{pendingRequests.length}</span>
            </div>
            <p className="text-sm text-muted mb-5">
              These people asked to join {group.name} before joining became instant. Approve to let them in, or decline to turn them away.
            </p>
            <ul className="divide-y divide-hairline stagger-rows">
              {pendingRequests.map((member: any) => (
                <li
                  key={member.user_id}
                  className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <AvatarStack people={[{ username: member.username }]} size="sm" className="flex-none" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{handle(member.username)}</p>
                      <p className="font-mono text-xs text-muted">
                        Requested {new Date(member.joined_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <button
                      onClick={() => handleMemberAction('approve', member.user_id, member.username)}
                      disabled={processing}
                      aria-label={`Approve ${handle(member.username)}`}
                      className="btn-quiet-success press disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleMemberAction('decline', member.user_id, member.username)}
                      disabled={processing}
                      aria-label={`Decline ${handle(member.username)}`}
                      className="btn-quiet-danger press disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
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
                      <AvatarStack people={[{ username: member.username }]} size="sm" className="flex-none" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{handle(member.username)}</p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          {member.user_id === group.created_by ? (
                            <span className="pill tone-info">Creator</span>
                          ) : (
                            <span className="text-xs text-muted">Member</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {member.user_id !== group.created_by && (
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row shrink-0">
                        <button
                          onClick={() => {
                            if (confirm(`Remove ${handle(member.username)} from the group?`)) {
                              handleMemberAction('remove', member.user_id, member.username);
                            }
                          }}
                          disabled={processing}
                          aria-label={`Remove ${handle(member.username)} from group`}
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
            <EmptySlip
              headline="No one's here yet."
              body="Invite people and they'll show up here."
              action={{ label: 'Invite more people', href: `/groups/${params.id}` }}
            />
          )}
        </section>

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
      </div>
    </>
  );
}
