import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Group } from '@/lib/types';
import { requireAuth, verifyUserMatch } from '@/lib/auth';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Generate a cryptographically secure random 6-digit group ID
function generateGroupId(): string {
  const num = crypto.randomInt(100000, 999999);
  return num.toString();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const groupId = searchParams.get('id');
  const publicOnly = searchParams.get('public') === 'true';

  // Get public groups (available to everyone)
  if (publicOnly) {
    const publicGroups = await db.groups.getPublic();
    
    // Get member info for each public group
    const groupsWithInfo = await Promise.all(
      publicGroups.map(async (group) => {
        const members = await db.groupMembers.getByGroup(group.id);
        const activeMembers = members.filter(m => m.status === 'active');
        
        return {
          ...group,
          member_count: activeMembers.length,
          admin_count: activeMembers.filter(m => m.role === 'admin').length,
          is_admin: false,
        };
      })
    );

    return NextResponse.json(groupsWithInfo);
  }

  // Get specific group
  if (groupId) {
    const group = await db.groups.get(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // Get members
    const members = await db.groupMembers.getByGroup(groupId);
    const pendingRequests = await db.groupMembers.getPendingByGroup(groupId);
    const activeMembers = members.filter(m => m.status === 'active');
    const resolver = group.is_public
      ? null
      : activeMembers.find(m => m.user_id === group.resolver_user_id) ||
        activeMembers.find(m => m.user_id === group.created_by) ||
        activeMembers.find(m => m.role === 'admin') ||
        activeMembers[0] ||
        null;

    return NextResponse.json({
      ...group,
      resolver,
      members: activeMembers,
      pending_requests: pendingRequests,
      member_count: activeMembers.length,
      admin_count: activeMembers.filter(m => m.role === 'admin').length,
    });
  }

  // Get groups for user (only groups they're actually a member of)
  if (userId) {
    const userGroups = await db.groups.getByUser(userId);
    
    // Get member info for each group
    const groupsWithInfo = await Promise.all(
      userGroups.map(async (group) => {
        const members = await db.groupMembers.getByGroup(group.id);
        const activeMembers = members.filter(m => m.status === 'active');
        const userMembership = members.find(m => m.user_id === userId);
        const resolver = group.is_public
          ? null
          : activeMembers.find(m => m.user_id === group.resolver_user_id) ||
            activeMembers.find(m => m.user_id === group.created_by) ||
            activeMembers.find(m => m.role === 'admin') ||
            activeMembers[0] ||
            null;
        
        return {
          ...group,
          resolver,
          member_count: activeMembers.length,
          admin_count: activeMembers.filter(m => m.role === 'admin').length,
          user_role: userMembership?.role || 'member',
          is_admin: userMembership?.role === 'admin',
          is_member: !!userMembership && userMembership.status === 'active',
        };
      })
    );

    return NextResponse.json(groupsWithInfo);
  }

  return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const { name, created_by, is_public } = body;

  if (!name || !created_by) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const mismatch = verifyUserMatch(authResult.userId, created_by);
  if (mismatch) return mismatch;

  // Generate unique group ID
  let groupId = generateGroupId();
  let attempts = 0;
  while (attempts < 10) {
    const existing = await db.groups.get(groupId);
    if (!existing) break;
    groupId = generateGroupId();
    attempts++;
  }

  if (attempts >= 10) {
    return NextResponse.json({ error: 'Failed to generate unique group ID' }, { status: 500 });
  }

  const newGroup: Group = {
    id: groupId,
    name: name.trim(),
    created_by,
    is_public: is_public || false,
  };

  await db.groups.create(newGroup);

  // Add creator as admin with active status
  await db.groupMembers.create({
    group_id: groupId,
    user_id: created_by,
    role: 'admin',
    status: 'active',
  });

  return NextResponse.json(newGroup);
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const { id, resolver_user_id, is_public } = body;

  if (!id) {
    return NextResponse.json({ error: 'Missing group id' }, { status: 400 });
  }

  const isAdmin = await db.groupMembers.isAdmin(id, authResult.userId);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Only group admins can update group settings' }, { status: 403 });
  }

  if (resolver_user_id) {
    const resolverMember = await db.groupMembers.get(id, resolver_user_id);
    if (!resolverMember || resolverMember.status !== 'active') {
      return NextResponse.json({ error: 'Resolver must be an active group member' }, { status: 400 });
    }
  }

  const group = await db.groups.update(id, {
    resolver_user_id,
    is_public,
  });

  return NextResponse.json(group);
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get('id');

  if (!groupId) {
    return NextResponse.json({ error: 'Missing group id' }, { status: 400 });
  }

  const group = await db.groups.get(groupId);
  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  if (group.created_by !== authResult.userId) {
    return NextResponse.json({ error: 'Only the group creator can delete this group' }, { status: 403 });
  }

  await db.groups.delete(groupId);

  return NextResponse.json({ success: true });
}
