import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { Comment } from '@/lib/types';
import { requireAuth, verifyUserMatch } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get('eventId');

  if (!eventId) {
    return NextResponse.json({ error: 'Missing eventId parameter' }, { status: 400 });
  }

  const comments = await db.comments.getByEvent(eventId);
  return NextResponse.json(comments);
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const { event_id, user_id, username, content } = body;

  if (!event_id || !user_id || !username || !content) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const mismatch = verifyUserMatch(authResult.userId, user_id);
  if (mismatch) return mismatch;

  // Verify event exists
  const event = await db.events.get(event_id);
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const timestamp = Date.now();

  const newComment: Comment = {
    id: generateId(),
    event_id,
    user_id,
    username,
    content: content.trim(),
    timestamp,
  };

  await db.comments.create(newComment);

  // Add to activity feed
  try {
    await db.activities.add({
      type: 'comment',
      timestamp,
      event_id,
      event_title: event.title,
      user_id,
      username,
      note: content.trim(), // Using 'note' field to store comment content
    });
  } catch (error) {
    console.error('[Comments API] Failed to add to activity feed:', error);
  }

  return NextResponse.json(newComment);
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const commentId = searchParams.get('id');

  if (!commentId) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  }

  // Only the comment owner can delete
  const comment = await db.comments.get(commentId);
  if (comment) {
    const mismatch = verifyUserMatch(authResult.userId, comment.user_id);
    if (mismatch) return mismatch;
  }

  await db.comments.delete(commentId);
  return NextResponse.json({ message: 'Comment deleted' });
}

