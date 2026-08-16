import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, verifyUserMatch } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { group_id, user_id } = body;

    if (!group_id || !user_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const mismatch = verifyUserMatch(authResult.userId, user_id);
    if (mismatch) return mismatch;

    // Check if group exists
    const group = await db.groups.get(group_id);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // Verify user exists in database
    const user = await db.users.get(user_id);
    if (!user) {
      return NextResponse.json({ error: 'User not found. Please try again.' }, { status: 400 });
    }

    // Check if user is already a member
    const existingMembership = await db.groupMembers.get(group_id, user_id);
    if (existingMembership) {
      if (existingMembership.status === 'active') {
        return NextResponse.json({ error: 'Already a member of this group' }, { status: 400 });
      }
      if (existingMembership.status === 'pending') {
        return NextResponse.json({ error: 'Join request already pending' }, { status: 400 });
      }
    }

    // Create pending membership request
    const newMember = await db.groupMembers.create({
      group_id,
      user_id,
      role: 'member',
      status: 'pending',
    });

    return NextResponse.json({ 
      message: 'Join request submitted',
      membership: newMember,
    });
  } catch (error) {
    console.error('Error joining group:', error);
    return NextResponse.json({ error: 'Failed to join group' }, { status: 500 });
  }
}

