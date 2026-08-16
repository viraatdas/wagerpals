import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { EscrowHoldStatus, Event, PaymentType } from '@/lib/types';
import { notifyEventAudience, applySubjectPrivacy } from '@/lib/push';
import { requireAuth, verifyUserMatch } from '@/lib/auth';
import { getGroupResolver } from '@/lib/group-resolver';
import { MAX_TRANSACTION_AMOUNT } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const groupId = searchParams.get('groupId');

  if (id) {
    const event = await db.events.get(id);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const isCash = event.payment_type === 'cash';
    const [bets, group, escrow_total, escrow_by_bet] = await Promise.all([
      db.bets.getByEvent(id),
      db.groups.get(event.group_id),
      isCash ? db.escrowHolds.getHeldTotalForEvent(id) : Promise.resolve(0),
      // Every player's escrow status, not just the caller's: the ledger renders
      // an escrow chip on each cash bet regardless of who placed it.
      isCash
        ? db.escrowHolds.getStatusByBetForEvent(id)
        : Promise.resolve({} as Record<string, EscrowHoldStatus>),
    ]);
    const sideStats: Record<string, { count: number; total: number }> = {
      [event.side_a]: { count: 0, total: 0 },
      [event.side_b]: { count: 0, total: 0 },
    };

    // Include all bets (including late bets) in side stats
    bets.forEach(bet => {
      sideStats[bet.side].count++;
      sideStats[bet.side].total += bet.amount;
    });
    
    // Round totals to 2 decimal places
    Object.keys(sideStats).forEach(side => {
      sideStats[side].total = Math.round(sideStats[side].total * 100) / 100;
    });

    // Count unique participants
    const uniqueParticipants = new Set(bets.map(b => b.user_id)).size;
    const resolver = group && !group.is_public ? await getGroupResolver(group.id) : null;

    return NextResponse.json({
      ...event,
      is_public: group?.is_public || false,
      resolver,
      bets,
      side_stats: sideStats,
      total_bets: bets.length,
      total_participants: uniqueParticipants,
      escrow_total,
      escrow_by_bet,
    });
  }

  // Optimized: single query with JOINs instead of N+1
  const eventsWithStats = await db.events.getAllWithStats(groupId || undefined);
  return NextResponse.json(eventsWithStats, {
    headers: {
      'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=30',
    },
  });
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const {
    title, description, side_a, side_b, end_time, group_id, creator_user_id, creator_username,
    payment_type: rawPaymentType, stake_amount: rawStakeAmount, subject_user_id, notify_subject,
  } = body;

  if (!title || !side_a || !side_b || !end_time || !group_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  let payment_type: PaymentType = 'none';
  if (rawPaymentType !== undefined && rawPaymentType !== null) {
    if (rawPaymentType !== 'none' && rawPaymentType !== 'cash') {
      return NextResponse.json({ error: 'payment_type must be "none" or "cash"' }, { status: 400 });
    }
    payment_type = rawPaymentType;
  }

  let stake_amount: number | null = null;
  if (payment_type === 'cash' && rawStakeAmount !== undefined && rawStakeAmount !== null) {
    const parsedStake = parseFloat(rawStakeAmount);
    if (!Number.isFinite(parsedStake) || !(parsedStake > 0)) {
      return NextResponse.json({ error: 'Stake must be greater than $0' }, { status: 400 });
    }
    if (parsedStake > MAX_TRANSACTION_AMOUNT) {
      return NextResponse.json({ error: 'Maximum stake is $500' }, { status: 400 });
    }
    stake_amount = Math.round(parsedStake * 100) / 100;
  }

  const subjectUserId: string | null = typeof subject_user_id === 'string' ? subject_user_id : null;
  // `null` means "not specified" here, same as omitting it — only an explicit
  // `false` suppresses the subject's notification. Coercing null to false
  // would silently mute someone because a form sent an empty value.
  const notifySubject: boolean = notify_subject === undefined || notify_subject === null ? true : !!notify_subject;

  if (creator_user_id) {
    const mismatch = verifyUserMatch(authResult.userId, creator_user_id);
    if (mismatch) return mismatch;
  }

  // Verify group exists and user is a member
  const group = await db.groups.get(group_id);
  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  if (creator_user_id) {
    const isMember = await db.groupMembers.isMember(group_id, creator_user_id);
    if (!isMember) {
      return NextResponse.json({ error: 'You must be a member of this group to create events' }, { status: 403 });
    }
  }

  if (subjectUserId) {
    const isSubjectMember = await db.groupMembers.isMember(group_id, subjectUserId);
    if (!isSubjectMember) {
      return NextResponse.json({ error: 'Subject must be a member of this group' }, { status: 400 });
    }
  }

  const timestamp = Date.now();

  const newEvent: Event = {
    id: generateId(),
    title: title.trim(),
    description: description?.trim(),
    side_a: side_a.trim(),
    side_b: side_b.trim(),
    end_time: parseInt(end_time),
    group_id,
    status: 'active',
    payment_type,
    stake_amount,
    subject_user_id: subjectUserId,
    notify_subject: notifySubject,
  };

  await db.events.create(newEvent);

  await applySubjectPrivacy(newEvent.id, subjectUserId, notifySubject);

  // Add to activity feed if creator info is provided
  if (creator_username) {
    const activityData = {
      type: 'event_created' as const,
      timestamp,
      event_id: newEvent.id,
      event_title: newEvent.title,
      user_id: creator_user_id,
      username: creator_username,
    };
    
    try {
      await db.activities.add(activityData);
    } catch (error: any) {
      console.error('[Events API] Failed to add to activity feed:', error);
    }
  }

  // Notify the group (never the whole platform, never a hidden subject)
  try {
    const creatorText = creator_username ? ` by ${creator_username}` : '';
    const cashText = payment_type === 'cash'
      ? (stake_amount !== null ? ` · $${stake_amount.toFixed(2)} stake` : ' · real money')
      : '';
    await notifyEventAudience({
      eventId: newEvent.id,
      category: 'bets',
      payload: {
        title: '🎲 New Bet Created!',
        body: `${newEvent.title}${creatorText}${cashText}`,
        url: `/events/${newEvent.id}`,
        eventId: newEvent.id,
        tag: `event-${newEvent.id}`,
      },
      excludeUserIds: creator_user_id ? [creator_user_id] : [],
    });
  } catch (error: any) {
    console.error('[Events API] Failed to send push notifications:', error);
  }

  return NextResponse.json(newEvent);
}
