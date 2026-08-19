import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { EscrowHoldStatus, Event, PaymentType } from '@/lib/types';
import { notifyEventAudience, applySubjectPrivacy } from '@/lib/push';
import { requireAuth, verifyUserMatch, getAuthenticatedUserId } from '@/lib/auth';
import { MAX_TRANSACTION_AMOUNT } from '@/lib/payments';

export const dynamic = 'force-dynamic';

// A fresh event's end_time is a meaningless placeholder now (R1: events are
// LIVE until the creator resolves them, never by time), but the column is
// still NOT NULL and lib/payments.ts's placeCashBet still rejects a cash bet
// once Date.now() passes it — that gate lives in money-movement logic this
// task does not touch. A ~100-year-out placeholder satisfies the column
// without ever tripping that (or any other still-live end_time comparison
// in app/api/bets/** and app/api/imessage/**, also outside this task's file
// scope) — see the final report for the full cross-cutting flag.
const NO_EXPIRY_PLACEHOLDER_MS = 100 * 365 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const groupId = searchParams.get('groupId');

  // Both branches below are deliberately readable without a session (kept
  // from the pre-existing behavior) — `viewerId` is only used to apply the
  // R4 "quiet bet" visibility rule (lib/utils.ts: isEventHiddenFromViewer)
  // when there IS a caller, never to gate the read itself.
  const viewerId = await getAuthenticatedUserId(request);

  if (id) {
    const event = await db.events.get(id, viewerId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // W-currency: play events escrow W exactly like cash events escrow USD,
    // so escrow_total/escrow_by_bet are computed for EVERY event now — the
    // old `isCash` gate here would have blinded the escrow chips (§8
    // invariant) for W bets. Legacy hold-less play bets simply don't appear
    // in the map, which the chip gating already handles.
    const [bets, group, escrow_total, escrow_by_bet] = await Promise.all([
      db.bets.getByEvent(id),
      db.groups.get(event.group_id),
      db.escrowHolds.getHeldTotalForEvent(id),
      // Every player's escrow status, not just the caller's: the ledger renders
      // an escrow chip on each escrowed bet regardless of who placed it.
      db.escrowHolds.getStatusByBetForEvent(id),
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

    // R2: the creator resolves the event (fallback: the group's creator, for
    // legacy rows with no created_by). group-resolver.ts's admin/resolver
    // logic no longer decides who this is — see lib/group-resolver.ts's
    // header comment. Kept under the `resolver` key for any existing caller
    // of this field; `created_by`/`creator_username` are the explicit R2
    // fields new code should read instead.
    const creatorId = event.created_by ?? group?.created_by ?? null;
    const creator = creatorId ? await db.users.get(creatorId) : null;
    const resolver = creator ? { user_id: creator.id, username: creator.username } : null;

    return NextResponse.json({
      ...event,
      is_public: group?.is_public || false,
      created_by: creatorId,
      creator_username: creator?.username ?? null,
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
  const eventsWithStats = await db.events.getAllWithStats(groupId || undefined, viewerId);
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

  if (!title || !side_a || !side_b || !group_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // R1: events have no expiry — LIVE until the creator resolves them, never
  // by time. end_time is now optional; when omitted the server fills a
  // meaningless far-future placeholder purely to satisfy the NOT NULL
  // column (see NO_EXPIRY_PLACEHOLDER_MS above for why "far future" and not
  // literally "now"). Nothing downstream in this route branches on it.
  let resolvedEndTime: number;
  if (end_time === undefined || end_time === null || end_time === '') {
    resolvedEndTime = Date.now() + NO_EXPIRY_PLACEHOLDER_MS;
  } else {
    const parsedEndTime = parseInt(end_time);
    if (!Number.isFinite(parsedEndTime)) {
      return NextResponse.json({ error: 'end_time must be a timestamp' }, { status: 400 });
    }
    resolvedEndTime = parsedEndTime;
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

  // The server is the gate, not the client: a group is either cash-enabled or
  // it isn't, and that decides whether a cash event can be created in it —
  // regardless of what the client sent or hid in its UI.
  if (payment_type === 'cash' && !group.cash_enabled) {
    return NextResponse.json(
      { error: "Cash wagers aren't enabled for this group. The group creator can turn them on." },
      { status: 403 }
    );
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
    end_time: resolvedEndTime,
    group_id,
    status: 'active',
    payment_type,
    stake_amount,
    subject_user_id: subjectUserId,
    notify_subject: notifySubject,
    // R2: always the authenticated caller, never taken from the request
    // body — this is the sole gate on who may later resolve this event.
    created_by: authResult.userId,
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
