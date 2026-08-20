import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { Comment, CommentWithMeta, Event, Group } from '@/lib/types';
import { requireAuth } from '@/lib/auth';
import { notifyUsers, notifyEventAudience } from '@/lib/push';
import {
  COMMENT_PAGE_SIZE,
  isAllowedReaction,
  validateCommentContent,
  parseMentionUsernames,
  resolveParentId,
  checkCommentRateLimit,
} from '@/lib/comments';

export const dynamic = 'force-dynamic';

// How much of a comment's content leaks into a push notification's body.
// Long enough to be useful, short enough that the full text still requires
// opening the app (and, more importantly, so a truncated tombstone/mention
// preview can't accidentally dump an entire essay into a lock screen).
const NOTIFICATION_BODY_LIMIT = 120;

// A malformed body is the client's mistake, not ours: answer 400 rather than
// letting request.json()'s SyntaxError fall through to the handler's 500.
async function readJsonBody(request: NextRequest): Promise<any | NextResponse> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    return body;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

function truncateForNotification(content: string): string {
  if (content.length <= NOTIFICATION_BODY_LIMIT) return content;
  return content.slice(0, NOTIFICATION_BODY_LIMIT - 1).trimEnd() + '…';
}

// --- shared auth/event/group/membership resolution -------------------------
//
// Every handler on this route needs some subset of {authed user, event,
// group, viewer's membership row}. Centralizing it means the authorization
// rules (public-group read vs. active-membership write) are defined once.

type AuthedContext = {
  userId: string;
  event: Event;
  group: Group;
  membership: Awaited<ReturnType<typeof db.groupMembers.get>>;
};

async function loadAuthedEventContext(
  request: NextRequest,
  eventId: string
): Promise<AuthedContext | NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  // Viewer-aware: a bet hidden from its subject (R4) must be unreachable
  // through its comments too — db.events.get returns null for that viewer.
  const event = await db.events.get(eventId, authResult.userId);
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  const group = await db.groups.get(event.group_id);
  if (!group) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  const membership = await db.groupMembers.get(group.id, authResult.userId);

  return { userId: authResult.userId, event, group, membership };
}

// Re-derive the canonical display username (and avatar) server-side rather
// than trusting the request body — closes the audit finding that
// comments.username was writable by whoever sent the POST, and, the same
// way, lets a freshly-posted comment show the real avatar immediately
// rather than waiting for a refetch. Falls back to a body-supplied username
// only when there is genuinely no user row yet (should not normally happen
// for an authenticated caller, but fails soft rather than 500ing).
async function resolveCanonicalAuthor(
  userId: string,
  bodyUsername: unknown
): Promise<{ username: string; avatar_url: string | null }> {
  const user = await db.users.get(userId);
  if (user) return { username: user.username, avatar_url: user.avatar_url ?? null };
  return {
    username: typeof bodyUsername === 'string' && bodyUsername.trim() ? bodyUsername.trim() : 'Unknown',
    avatar_url: null,
  };
}

// Resolve the subset of mentioned usernames that belong to ACTIVE group
// members, case-insensitively, excluding the author. Never mention someone
// who isn't an active member (they may not even be able to see the thread).
async function resolveMentionIds(content: string, groupId: string, authorId: string): Promise<string[]> {
  const usernames = parseMentionUsernames(content);
  if (usernames.length === 0) return [];
  const members = await db.groupMembers.getByGroup(groupId);
  const byLowerUsername = new Map<string, string>();
  for (const m of members) {
    if (m.status === 'active' && m.username) {
      byLowerUsername.set(m.username.toLowerCase(), m.user_id);
    }
  }
  const ids = new Set<string>();
  for (const uname of usernames) {
    const id = byLowerUsername.get(uname.toLowerCase());
    if (id && id !== authorId) ids.add(id);
  }
  return Array.from(ids);
}

function computeReplyCount(commentId: string, allComments: Comment[]): number {
  let count = 0;
  for (const c of allComments) {
    if (c.parent_id === commentId) count++;
  }
  return count;
}

// --- GET ---------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');

    if (!eventId) {
      return NextResponse.json({ error: 'Missing eventId parameter' }, { status: 400 });
    }

    const ctx = await loadAuthedEventContext(request, eventId);
    if (ctx instanceof NextResponse) return ctx;
    const { userId, event, group, membership } = ctx;

    const isActiveMember = membership?.status === 'active';
    if (!group.is_public && !isActiveMember) {
      return NextResponse.json({ error: 'You do not have access to this event' }, { status: 403 });
    }

    const view = searchParams.get('view');

    if (view !== 'thread') {
      // Back-compat: bare Comment[] for the Expo app (mobile/src/services/api.ts).
      const comments = await db.comments.getByEvent(eventId);
      return NextResponse.json(comments);
    }

    // Thread mode. The whole event thread is loaded per request and paging
    // (root selection + tombstone inclusion) happens in-process here rather
    // than in SQL — fine at current thread sizes, and the place to push
    // this down into a real SQL LIMIT/OFFSET query if threads grow large.
    //
    // db.comments.getThreadByEvent excludes soft-deleted rows (it's built on
    // getByEvent's default), but tombstones must still appear in the thread
    // (scrubbed) so replies keep visible context — so this composes the
    // batched accessors directly instead of using that helper.
    const rawComments = await db.comments.getByEvent(eventId, { includeDeleted: true });
    const commentIds = rawComments.map((c) => c.id);
    const [reactionsByComment, mentionsByComment] = await Promise.all([
      db.commentReactions.getByComments(commentIds),
      db.commentMentions.getByComments(commentIds),
    ]);
    const replyCounts = new Map<string, number>();
    for (const c of rawComments) {
      if (c.parent_id) replyCounts.set(c.parent_id, (replyCounts.get(c.parent_id) || 0) + 1);
    }
    const allComments: CommentWithMeta[] = rawComments.map((c) => ({
      ...c,
      reactions: reactionsByComment[c.id] || [],
      mention_user_ids: mentionsByComment[c.id] || [],
      reply_count: replyCounts.get(c.id) || 0,
    }));

    const rawLimit = parseInt(searchParams.get('limit') || '', 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : COMMENT_PAGE_SIZE;
    const beforeParam = searchParams.get('before');
    const before = beforeParam ? parseInt(beforeParam, 10) : null;

    // A tombstoned root that nobody replied to is pure noise — there is no
    // reply left needing its context — so it is dropped entirely rather than
    // burning a page slot on a "Comment deleted" row.
    const idsWithReplies = new Set(allComments.map((c) => c.parent_id).filter(Boolean) as string[]);

    const roots = allComments
      .filter((c) => !c.parent_id)
      .filter((c) => !c.deleted_at || idsWithReplies.has(c.id))
      .filter((c) => (before !== null && Number.isFinite(before) ? c.timestamp < before : true))
      .sort((a, b) => b.timestamp - a.timestamp); // newest first, for paging

    const hasMore = roots.length > limit;
    const pageRoots = roots.slice(0, limit);
    const pageRootIds = new Set(pageRoots.map((r) => r.id));

    // Every transitive descendant of a page root also belongs on the page.
    // Comments are timestamp-ordered so a parent always precedes its
    // children; walk once, growing the included-id set as we go.
    const includedIds = new Set(pageRootIds);
    const sortedAsc = [...allComments].sort((a, b) => a.timestamp - b.timestamp);
    for (const c of sortedAsc) {
      if (c.parent_id && includedIds.has(c.parent_id)) {
        includedIds.add(c.id);
      }
    }

    const pageComments: CommentWithMeta[] = sortedAsc
      .filter((c) => includedIds.has(c.id))
      .map((c) => {
        if (c.deleted_at) {
          // Tombstones are included so replies keep a valid parent, but leak
          // nothing about who wrote the deleted content or what it said.
          return { ...c, content: '', username: '', avatar_url: null };
        }
        return c;
      });

    const totalCount = allComments.filter((c) => !c.deleted_at).length;
    const oldestPageRoot = pageRoots.length > 0 ? pageRoots[pageRoots.length - 1] : null;

    const members = (await db.groupMembers.getByGroup(group.id))
      .filter((m) => m.status === 'active')
      .map((m) => ({ user_id: m.user_id, username: m.username || '', role: m.role }));

    return NextResponse.json({
      comments: pageComments,
      members,
      viewer: { user_id: userId, is_group_admin: membership?.role === 'admin' && isActiveMember },
      total_count: totalCount,
      has_more: hasMore,
      next_before: oldestPageRoot ? oldestPageRoot.timestamp : null,
    });
  } catch (error) {
    console.error('[Comments API] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load comments' }, { status: 500 });
  }
}

// --- POST (create comment or reply) -------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const { event_id, parent_id, content, username: bodyUsername } = body;

    if (!event_id) {
      return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });
    }

    // Authorize before validating the payload: an unauthenticated caller
    // should always see 401, never a hint about what the body needs to say.
    const ctx = await loadAuthedEventContext(request, event_id);
    if (ctx instanceof NextResponse) return ctx;
    const { userId, event, group, membership } = ctx;

    const validation = validateCommentContent(content);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Reading a public group's comments is open, but posting always requires
    // active membership (public visibility != write access).
    if (membership?.status !== 'active') {
      return NextResponse.json({ error: 'Join this group to comment' }, { status: 403 });
    }

    const rateLimit = checkCommentRateLimit(userId);
    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000));
      return NextResponse.json(
        { error: 'You are commenting too fast. Try again in a moment.', retry_after_ms: rateLimit.retryAfterMs },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
      );
    }

    const allComments = await db.comments.getByEvent(event_id, { includeDeleted: true });
    const parentById = new Map<string, string | null | undefined>();
    for (const c of allComments) parentById.set(c.id, c.parent_id);

    let resolvedParentId: string | null = null;
    if (parent_id) {
      const parentComment = allComments.find((c) => c.id === parent_id);
      if (!parentComment || parentComment.deleted_at) {
        return NextResponse.json({ error: 'That comment no longer exists' }, { status: 400 });
      }
      resolvedParentId = resolveParentId(parent_id, parentById);
    }

    const { username: canonicalUsername, avatar_url: canonicalAvatarUrl } = await resolveCanonicalAuthor(userId, bodyUsername);
    const timestamp = Date.now();
    const commentId = generateId();

    const newComment: Comment = {
      id: commentId,
      event_id,
      user_id: userId,
      username: canonicalUsername,
      avatar_url: canonicalAvatarUrl,
      content: validation.value!,
      timestamp,
      parent_id: resolvedParentId,
    };

    await db.comments.create(newComment);

    const mentionedIds = await resolveMentionIds(validation.value!, group.id, userId);
    if (mentionedIds.length > 0) {
      await db.commentMentions.createMany(commentId, mentionedIds);
    }

    // Activity feed only for top-level comments, so a busy reply thread
    // doesn't flood the group's shared activity feed.
    if (!resolvedParentId) {
      try {
        await db.activities.add({
          type: 'comment',
          timestamp,
          event_id,
          event_title: event.title,
          user_id: userId,
          username: canonicalUsername,
          note: validation.value!,
        });
      } catch (error) {
        console.error('[Comments API] Failed to add to activity feed:', error);
      }
    }

    const notificationBody = truncateForNotification(validation.value!);

    if (mentionedIds.length > 0) {
      try {
        await notifyUsers({
          userIds: mentionedIds,
          category: 'mentions',
          eventId: event_id,
          excludeUserIds: [userId],
          payload: {
            title: `${canonicalUsername} mentioned you`,
            body: notificationBody,
            url: `/events/${event_id}`,
            tag: `comment-${commentId}`,
          },
        });
      } catch (error) {
        console.error('[Comments API] Failed to notify mentioned users:', error);
      }
    }

    try {
      await notifyEventAudience({
        eventId: event_id,
        category: 'comments',
        excludeUserIds: [userId, ...mentionedIds],
        payload: {
          title: `💬 ${canonicalUsername} commented`,
          body: notificationBody,
          url: `/events/${event_id}`,
          tag: `comment-${commentId}`,
        },
      });
    } catch (error) {
      console.error('[Comments API] Failed to notify event audience:', error);
    }

    const result: CommentWithMeta = {
      ...newComment,
      reactions: [],
      mention_user_ids: mentionedIds,
      reply_count: 0,
    };

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('[Comments API] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 });
  }
}

// --- PATCH (edit) --------------------------------------------------------

export async function PATCH(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { userId } = authResult;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const { id, content } = body;
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const comment = await db.comments.get(id);
    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }
    if (comment.deleted_at) {
      return NextResponse.json({ error: 'This comment was deleted' }, { status: 400 });
    }
    // Admins may delete other people's comments, but never edit someone
    // else's words on their behalf.
    if (comment.user_id !== userId) {
      return NextResponse.json({ error: 'You can only edit your own comments' }, { status: 403 });
    }

    const validation = validateCommentContent(content);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const event = await db.events.get(comment.event_id, userId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const previousMentionIds = await db.commentMentions.getByComment(id);

    await db.comments.updateContent(id, validation.value!);

    const newMentionIds = await resolveMentionIds(validation.value!, event.group_id, userId);
    if (newMentionIds.length > 0) {
      // ON CONFLICT DO NOTHING inside createMany — old mention rows are never
      // deleted, so an edit can never silently un-notify someone who was
      // already mentioned.
      await db.commentMentions.createMany(id, newMentionIds);
    }

    const previousSet = new Set(previousMentionIds);
    const newlyMentioned = newMentionIds.filter((uid) => !previousSet.has(uid));
    if (newlyMentioned.length > 0) {
      try {
        await notifyUsers({
          userIds: newlyMentioned,
          category: 'mentions',
          eventId: comment.event_id,
          excludeUserIds: [userId],
          payload: {
            title: `${comment.username} mentioned you`,
            body: truncateForNotification(validation.value!),
            url: `/events/${comment.event_id}`,
            tag: `comment-${id}`,
          },
        });
      } catch (error) {
        console.error('[Comments API] Failed to notify newly-mentioned users:', error);
      }
    }

    const updated = await db.comments.get(id);
    const [reactions, mentionUserIds, allEventComments] = await Promise.all([
      db.commentReactions.getByComment(id),
      db.commentMentions.getByComment(id),
      db.comments.getByEvent(comment.event_id),
    ]);

    const result: CommentWithMeta = {
      ...(updated as Comment),
      reactions,
      mention_user_ids: mentionUserIds,
      reply_count: computeReplyCount(id, allEventComments),
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Comments API] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update comment' }, { status: 500 });
  }
}

// --- DELETE (tombstone) --------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { userId } = authResult;

    const { searchParams } = new URL(request.url);
    const commentId = searchParams.get('id');
    if (!commentId) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
    }

    const comment = await db.comments.get(commentId);
    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    const event = await db.events.get(comment.event_id, userId);
    // R3 (flat groups): moderation is creator-only — there are no admins.
    const isAuthor = comment.user_id === userId;
    const group = event ? await db.groups.get(event.group_id) : null;
    const isGroupCreator = !!group && group.created_by === userId;
    if (!isAuthor && !isGroupCreator) {
      return NextResponse.json(
        { error: 'Only the author or the group creator can delete this comment' },
        { status: 403 }
      );
    }

    // Idempotent: a repeat delete of an already-tombstoned comment by an
    // authorized actor is a 200, not an error.
    if (comment.deleted_at) {
      return NextResponse.json({
        message: 'Comment deleted',
        comment: { ...comment, content: '', username: '', avatar_url: null },
      });
    }

    // Soft delete only: a hard delete cascades in the schema and would take
    // this comment's replies down with it. softDelete just stamps
    // deleted_at, leaving the row (with content/username scrubbed on read)
    // as a tombstone so replies keep a valid parent_id.
    const tombstone = await db.comments.softDelete(commentId);

    return NextResponse.json({
      message: 'Comment deleted',
      comment: { ...(tombstone as Comment), content: '', username: '', avatar_url: null },
    });
  } catch (error) {
    console.error('[Comments API] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 });
  }
}

// --- PUT (toggle emoji reaction) -----------------------------------------
//
// Kept on this route (rather than a separate reactions endpoint) so the
// comments API stays one file.

export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { userId } = authResult;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const { comment_id, emoji } = body;

    if (!comment_id || !emoji || !isAllowedReaction(emoji)) {
      return NextResponse.json({ error: 'Unsupported reaction' }, { status: 400 });
    }

    const comment = await db.comments.get(comment_id);
    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }
    if (comment.deleted_at) {
      return NextResponse.json({ error: 'This comment was deleted' }, { status: 400 });
    }

    const event = await db.events.get(comment.event_id, userId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    const isActiveMember = await db.groupMembers.isMember(event.group_id, userId);
    if (!isActiveMember) {
      return NextResponse.json({ error: 'You do not have access to this event' }, { status: 403 });
    }

    const { added } = await db.commentReactions.toggle(comment_id, userId, emoji);
    const reactions = await db.commentReactions.getByComment(comment_id);

    return NextResponse.json({ comment_id, emoji, added, reactions });
  } catch (error) {
    console.error('[Comments API] PUT failed:', error);
    return NextResponse.json({ error: 'Failed to toggle reaction' }, { status: 500 });
  }
}
