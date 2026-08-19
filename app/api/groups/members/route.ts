import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendPushToUser } from '@/lib/push';
import { requireAuth, verifyUserMatch } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const { action, group_id, user_id, target_user_id, admin_user_id } = body;

  if (!action || !group_id || !admin_user_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Verify the requester is who they claim to be
  const mismatch = verifyUserMatch(authResult.userId, admin_user_id);
  if (mismatch) return mismatch;

  // R3: flat groups — moderation (approve/decline a legacy pending request,
  // promote/demote, remove/kick) is creator-only, replacing the old
  // role='admin' gate.
  const group = await db.groups.get(group_id);
  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }
  if (group.created_by !== admin_user_id) {
    return NextResponse.json({ error: 'Only the group creator can manage members' }, { status: 403 });
  }

  switch (action) {
    case 'approve':
      if (!target_user_id) {
        return NextResponse.json({ error: 'Missing target_user_id' }, { status: 400 });
      }
      await db.groupMembers.update(group_id, target_user_id, { status: 'active' });

      // Send push notification to approved user
      try {
        await sendPushToUser(target_user_id, {
          title: '✅ Approved!',
          body: `You've been accepted into ${group?.name || 'the group'}`,
          url: `/groups/${group_id}`,
          tag: `group-approved-${group_id}`,
        });
      } catch (error) {
        console.error('Failed to send approval notification:', error);
      }
      
      return NextResponse.json({ message: 'Member approved' });

    case 'decline':
      if (!target_user_id) {
        return NextResponse.json({ error: 'Missing target_user_id' }, { status: 400 });
      }
      await db.groupMembers.delete(group_id, target_user_id);
      return NextResponse.json({ message: 'Join request declined' });

    case 'promote':
      if (!target_user_id) {
        return NextResponse.json({ error: 'Missing target_user_id' }, { status: 400 });
      }
      await db.groupMembers.update(group_id, target_user_id, { role: 'admin' });

      // Send push notification to promoted user
      try {
        await sendPushToUser(target_user_id, {
          title: '🎉 Promoted to Admin!',
          body: `You're now an admin of ${group?.name || 'the group'}`,
          url: `/groups/${group_id}/admin`,
          tag: `group-promoted-${group_id}`,
        });
      } catch (error) {
        console.error('Failed to send promotion notification:', error);
      }
      
      return NextResponse.json({ message: 'Member promoted to admin' });

    case 'demote':
      if (!target_user_id) {
        return NextResponse.json({ error: 'Missing target_user_id' }, { status: 400 });
      }
      await db.groupMembers.update(group_id, target_user_id, { role: 'member' });
      return NextResponse.json({ message: 'Admin demoted to member' });

    case 'remove':
      if (!target_user_id) {
        return NextResponse.json({ error: 'Missing target_user_id' }, { status: 400 });
      }
      await db.groupMembers.delete(group_id, target_user_id);
      return NextResponse.json({ message: 'Member removed' });

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  // Same disclosure as GET /api/groups?id= — this returns the full roster
  // (user ids, usernames, roles, pending requests) for a group, so it is
  // gated the same way: authenticated, and an active member of that group.
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get('groupId');

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId parameter' }, { status: 400 });
  }

  const members = await db.groupMembers.getByGroup(groupId);

  const viewerMembership = members.find(m => m.user_id === authResult.userId);
  if (viewerMembership?.status !== 'active') {
    return NextResponse.json(
      { error: 'You must be an active member of this group to view its members' },
      { status: 403 }
    );
  }

  return NextResponse.json(members);
}

