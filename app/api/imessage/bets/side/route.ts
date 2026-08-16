import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { Bet } from '@/lib/types';
import { requireAuthUser } from '@/lib/auth';
import { syncUser } from '@/lib/sync-user';
import { notifyEventAudience } from '@/lib/push';
import { placeCashBet, isPaymentError } from '@/lib/payments';
import { verifyShareToken, buildEventPreview } from '@/lib/imessage-share';

export const dynamic = 'force-dynamic';

/**
 * Take a side on a wager from the iMessage bubble. Auth is required — the
 * caller must be a signed-in WagerPals user — but they need not already be a
 * member of the wager's group, which is what makes this different from
 * POST /api/bets.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const syncResult = await syncUser(authResult.user);
  if (!syncResult.ok) {
    return NextResponse.json({ error: syncResult.error }, { status: syncResult.status });
  }
  const userId = syncResult.user.id;
  const username = syncResult.user.username;

  const body = await request.json();
  const { event_id, side, amount, share_token } = body;

  if (!event_id || typeof event_id !== 'string' || !side || typeof side !== 'string') {
    return NextResponse.json({ error: 'event_id and side are required' }, { status: 400 });
  }

  const event = await db.events.get(event_id);
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  if (side !== event.side_a && side !== event.side_b) {
    return NextResponse.json({ error: 'Invalid side' }, { status: 400 });
  }

  // ---- Authorization ---------------------------------------------------
  // Two ways in: (a) the caller is already an ACTIVE member of the event's
  // group, or (b) they hold a share token that verifies for THIS event id.
  // A valid share token proves the caller actually received the wager's
  // iMessage bubble — receiving it IS the invitation, so granting access
  // this way also upserts an ACTIVE group_members row for them (create if
  // no row exists yet, flip an existing 'pending' row to 'active'), so
  // everything downstream of this request (activity feed visibility,
  // future bets, etc.) treats them as a normal member from here on.
  const alreadyMember = await db.groupMembers.isMember(event.group_id, userId);
  if (!alreadyMember) {
    if (!verifyShareToken(event_id, share_token)) {
      return NextResponse.json({ error: 'You do not have access to this wager' }, { status: 403 });
    }
    const existingMembership = await db.groupMembers.get(event.group_id, userId);
    if (existingMembership) {
      await db.groupMembers.update(event.group_id, userId, { status: 'active' });
    } else {
      await db.groupMembers.create({ group_id: event.group_id, user_id: userId, role: 'member', status: 'active' });
    }
  }

  // ---- Duplicate-bet guard ------------------------------------------------
  // DECISION: app/api/bets/route.ts places one bet per POST with no
  // duplicate/side-switch check at all (cash or free) — nothing there stops
  // a user from betting on the same event twice. Since this iMessage route
  // is the one place introducing an explicit dedupe rule, we scope it as
  // tightly as the spec requires and no further:
  //   - Cash events: reject ANY second bet from this user on this event,
  //     regardless of side. The first bet's stake is already escrowed in
  //     `escrow_holds`; reconciling a side switch would mean unwinding that
  //     hold, which is out of scope here (only a resolver cancelling the
  //     whole event does that today, via reverseCashSettlement).
  //   - Free events: reject only a second bet on the SAME side (nothing of
  //     value would change) but allow a bet on the other side, matching
  //     app/api/bets/route.ts's total absence of a restriction there.
  const existingBets = await db.bets.getByEvent(event_id);
  if (event.payment_type === 'cash') {
    if (existingBets.some(b => b.user_id === userId)) {
      return NextResponse.json(
        { error: 'You already placed a bet on this real-money wager' },
        { status: 400 }
      );
    }
  } else if (existingBets.some(b => b.user_id === userId && b.side === side)) {
    return NextResponse.json({ error: 'You already have a bet on this side' }, { status: 400 });
  }

  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return NextResponse.json({ error: 'A valid amount is required' }, { status: 400 });
  }

  let placedBet: Bet;

  // ---- Cash path: real-money bet, escrowed via placeCashBet ----
  if (event.payment_type === 'cash') {
    try {
      const result = await placeCashBet({
        eventId: event_id,
        userId,
        username,
        side,
        amount,
      });
      placedBet = result.bet;
    } catch (error: any) {
      if (isPaymentError(error)) {
        return NextResponse.json(
          { error: error.message, code: error.code, ...error.details },
          { status: error.status }
        );
      }
      console.error('[iMessage bet side] Failed to place cash bet:', error);
      return NextResponse.json({ error: 'Failed to place bet' }, { status: 500 });
    }
  } else {
    // ---- Free path: no money moves, points only ----
    const timestamp = Date.now();
    const isLate = timestamp > event.end_time;
    const parsedAmount = Math.round(amount * 100) / 100;
    if (!(parsedAmount > 0)) {
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 });
    }
    const newBet: Bet = {
      id: generateId(),
      event_id,
      user_id: userId,
      username,
      side,
      amount: parsedAmount,
      timestamp,
      is_late: isLate,
    };
    await db.bets.create(newBet);
    placedBet = newBet;
  }

  // Update user's total_bet (only non-late bets count toward stats) —
  // mirrors both branches of app/api/bets/route.ts.
  if (!placedBet.is_late) {
    const user = await db.users.get(userId);
    if (user) {
      await db.users.update(userId, {
        total_bet: Math.round((user.total_bet + placedBet.amount) * 100) / 100,
      });
    }
  }

  // ---- Activity feed (best-effort — never fails the request) ----------------
  try {
    await db.activities.add({
      type: 'bet',
      timestamp: placedBet.timestamp,
      event_id,
      event_title: event.title,
      user_id: userId,
      username,
      side: placedBet.side,
      amount: placedBet.amount,
    });
  } catch (error) {
    console.error('[iMessage bet side] Failed to add to activity feed:', error);
  }

  // ---- Push notification (best-effort), same shape as app/api/bets/route.ts ----
  try {
    const lateText = placedBet.is_late ? ' (late bet)' : '';
    await notifyEventAudience({
      eventId: event_id,
      category: 'bets',
      payload: {
        title: `💰 New Bet Placed${lateText}`,
        body: `${username} bet $${placedBet.amount.toFixed(2)} on "${placedBet.side}" - ${event.title}`,
        url: `/events/${event_id}`,
        eventId: event_id,
        tag: `bet-${placedBet.id}`,
      },
      excludeUserIds: [userId],
    });
  } catch (error) {
    console.error('[iMessage bet side] Failed to send push notifications:', error);
  }

  // Recomputed preview (fresh read, not the pre-bet `existingBets`) so the
  // iMessage bubble can update immediately with this bet included.
  const allBets = await db.bets.getByEvent(event_id);
  const preview = buildEventPreview(event, allBets, true);

  return NextResponse.json({ bet_id: placedBet.id, preview }, { status: 200 });
}
