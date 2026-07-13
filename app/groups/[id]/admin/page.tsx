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
      
      // Check if user is admin
      const userMember = data.members.find((m: any) => m.user_id === uid);
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
        headers: { 'Content-Type': 'application/json', 'x-stack-user-id': user.id },
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
          'x-stack-user-id': user.id,
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
        headers: { 'x-stack-user-id': user.id },
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
      <div className="max-w-4xl mx-auto px-4 py-8 mobile-page">
        <div className="space-y-4">
          <div className="skeleton h-8 w-1/2 rounded-xl" />
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 mobile-page">
        <div className="glass-subtle rounded-3xl text-center py-12 px-6">
          <p className="text-center text-muted">Group not found</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Toast
        isOpen={toast !== null}
        onClose={() => setToast(null)}
        message={toast?.message || ''}
        type={toast?.type || 'info'}
      />
      <div className="max-w-4xl mx-auto px-4 py-8 mobile-page animate-rise">
        <div className="mb-6">
          <Link
            href={`/groups/${params.id}`}
            className="inline-block text-brand-2 hover:text-brand-1 transition-colors mb-2"
          >
            ← Back to Group
          </Link>
        <h1 className="text-2xl sm:text-3xl font-display font-semibold text-foreground break-words leading-tight">
          Manage {group.name}
        </h1>
        <p className="text-muted">Group Code: <span className="font-mono text-foreground">{group.id}</span></p>
      </div>

      <section className="mb-8">
        <h2 className="text-xl sm:text-2xl font-display font-semibold text-foreground mb-4 inline-block border-b-2 border-brand-2/60 pb-2">
          Paid Group Settings
        </h2>
        <div className="glass rounded-2xl p-4 mt-2 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-foreground">
                Status: <span className="font-semibold text-brand-2">{group.is_public ? 'Free points' : 'Paid wallet betting'}</span>
              </p>
              <p className="text-sm text-muted">
                Paid groups require wallet funds before members can place bets.
              </p>
            </div>
            <button
              onClick={() => handleGroupSettings({ is_public: !group.is_public })}
              disabled={processing}
              className="btn-primary w-full sm:w-auto text-sm disabled:opacity-50"
            >
              {group.is_public ? 'Enable Paid Betting' : 'Use Free Points'}
            </button>
          </div>

          {!group.is_public && (
            <div>
              <p className="text-foreground mb-2">
                Resolver: <span className="font-medium text-green-700">@{group.resolver?.username || 'Not set'}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {group.members.map((member: any) => (
                  <button
                    key={member.user_id}
                    onClick={() => handleGroupSettings({ resolver_user_id: member.user_id })}
                    disabled={processing || group.resolver?.user_id === member.user_id}
                    className={`px-3 py-2 rounded-xl text-sm border break-all transition-colors ${
                      group.resolver?.user_id === member.user_id
                        ? 'bg-green-50 border-green-300 text-green-700'
                        : 'bg-gray-50 border-gray-200 text-muted hover:border-brand-2/40 hover:text-foreground'
                    } disabled:cursor-not-allowed`}
                  >
                    @{member.username}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {group.pending_requests && group.pending_requests.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl sm:text-2xl font-display font-semibold text-foreground mb-4 inline-block border-b-2 border-brand-2/60 pb-2">
            Pending Requests
          </h2>
          <div className="space-y-3 mt-6 stagger">
            {group.pending_requests.map((member: any) => (
              <div
                key={member.user_id}
                className="glass rounded-2xl p-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-foreground break-all">{member.username}</p>
                  <p className="text-sm text-muted">
                    Requested: {new Date(member.joined_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <button
                    onClick={() => handleMemberAction('approve', member.user_id)}
                    disabled={processing}
                    className="px-4 py-2 rounded-full text-sm font-semibold text-green-700 bg-green-50 border border-green-300 hover:bg-green-100 disabled:opacity-50 transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleMemberAction('decline', member.user_id)}
                    disabled={processing}
                    className="px-4 py-2 rounded-full text-sm font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50 transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl sm:text-2xl font-display font-semibold text-foreground mb-4 inline-block border-b-2 border-gray-300 pb-2">
          Members ({group.members.length})
        </h2>
        <div className="space-y-3 mt-6 stagger">
          {group.members.map((member: any) => (
            <div
              key={member.user_id}
              className="glass rounded-2xl p-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="min-w-0">
                  <p className="text-foreground break-all">{member.username}</p>
                  <p className="text-sm text-muted">
                    {member.role === 'admin' ? '👑 Admin' : 'Member'}
                  </p>
                </div>
              </div>
              {member.user_id !== group.created_by && member.user_id !== user.id && (
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  {member.role === 'member' ? (
                    <button
                      onClick={() => handleMemberAction('promote', member.user_id)}
                      disabled={processing}
                      className="btn-primary text-sm disabled:opacity-50"
                    >
                      Promote to Admin
                    </button>
                  ) : (
                    <button
                      onClick={() => handleMemberAction('demote', member.user_id)}
                      disabled={processing}
                      className="btn-glass text-sm disabled:opacity-50"
                    >
                      Demote
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${member.username} from the group?`)) {
                        handleMemberAction('remove', member.user_id);
                      }
                    }}
                    disabled={processing}
                    className="px-4 py-2 rounded-full text-sm font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              )}
              {member.user_id === group.created_by && (
                <span className="chip text-sky-700 border-sky-200 bg-sky-50 w-fit">
                  Creator
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {user.id === group.created_by && (
        <section className="mt-8 glass rounded-2xl p-4 border-red-200">
          <h2 className="text-xl font-display font-semibold text-red-600 mb-2">Delete Group</h2>
          <p className="text-sm text-muted mb-4">
            This permanently removes the group, events, bets, comments, and memberships.
          </p>
          <button
            onClick={handleDeleteGroup}
            disabled={deleting}
            className="px-4 py-2 rounded-full text-sm font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            {deleting ? 'Deleting...' : 'Delete Group'}
          </button>
        </section>
      )}
      </div>
    </>
  );
}
