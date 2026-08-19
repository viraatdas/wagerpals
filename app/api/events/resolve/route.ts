import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { db } from '@/lib/db';
import { calculateNetResults } from '@/lib/utils';
import { notifyEventAudience } from '@/lib/push';
import { requireAuth } from '@/lib/auth';
import { settleCashEvent, isPaymentError, type SettleCashEventResult } from '@/lib/payments';

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const { event_id, winning_side, action } = body;
  const isCancel = action === 'cancel';

  if (!event_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const event = await db.events.get(event_id);
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  if (!isCancel && (!winning_side || (winning_side !== event.side_a && winning_side !== event.side_b))) {
    return NextResponse.json({ error: 'Invalid winning side' }, { status: 400 });
  }

  if (event.status === 'resolved') {
    return NextResponse.json({ error: 'Event already resolved' }, { status: 400 });
  }

  // R2: only the event's creator may resolve/cancel it — regardless of
  // payment_type or the group's is_public flag. group-resolver.ts's
  // admin/chosen-resolver logic no longer has any say here (see that
  // file's header comment). group.created_by is the fallback for legacy
  // events created before the created_by column existed.
  const group = await db.groups.get(event.group_id);
  const resolverUserId = event.created_by ?? group?.created_by ?? null;
  if (!resolverUserId || resolverUserId !== authResult.userId) {
    const message = isCancel
      ? 'Only the event creator can resolve or cancel this event'
      : 'Only the event creator can resolve this event';
    return NextResponse.json({ error: message }, { status: 403 });
  }

  // Cancel refunds every held stake via settleCashEvent(eventId, null) below
  // — that now works identically for a cash event's usd escrow and a play
  // event's W escrow (see lib/payments.ts's currencyForEvent), so cancel is
  // no longer restricted to payment_type === 'cash'. A legacy play event
  // with no escrow at all (pre-W bets) is a harmless noop here — the same
  // no_holds path settleCashEvent already returns for any event with
  // nothing held.

  if (isCancel) {
    let settlement: SettleCashEventResult;
    try {
      settlement = await settleCashEvent(event_id, null);
    } catch (error: any) {
      if (isPaymentError(error)) {
        return NextResponse.json(
          { error: error.message, code: error.code, ...error.details },
          { status: error.status }
        );
      }
      console.error('[Resolve API] Failed to cancel event:', error);
      return NextResponse.json({ error: 'Failed to settle event' }, { status: 500 });
    }

    const resolved_at = Date.now();

    // A cancelled event is "resolved" with no winning side. db.events.update
    // can't write resolved_at without a winning_side, so this goes straight
    // through raw SQL instead.
    await sql`UPDATE events SET status = 'resolved', winning_side = NULL, resolved_at = ${resolved_at} WHERE id = ${event_id}`;

    // Same race window as the resolve path below: a bet could have committed
    // between the refund above and this status update, stranding its hold.
    // The event is resolved now, so no new hold can appear and one sweep is
    // enough. Refunds again (winningSide null), so nobody loses money.
    try {
      const sweep = await settleCashEvent(event_id, null);
      if (sweep.holds_settled > 0) {
        console.warn(`[Resolve API] Swept ${sweep.holds_settled} late hold(s) on cancelled event ${event_id}`);
      }
    } catch (error: any) {
      console.error('[Resolve API] Post-cancel escrow sweep failed:', error);
    }

    // No winners or losers on a cancelled event — leave net_total/streak alone.

    // Add to activity feed
    const activityData = {
      type: 'resolution' as const,
      timestamp: resolved_at,
      event_id,
      event_title: event.title,
      username: 'System',
      winning_side: 'Cancelled',
    };

    try {
      await db.activities.add(activityData);
    } catch (error: any) {
      console.error('[Resolve API] Failed to add to activity feed:', error);
    }

    // Send push notification
    try {
      await notifyEventAudience({
        eventId: event_id,
        category: 'resolutions',
        payload: {
          title: '↩️ Event Cancelled',
          body: `"${event.title}" was cancelled. Every stake has been refunded.`,
          url: `/events/${event_id}`,
          eventId: event_id,
          tag: `resolution-${event_id}`,
        },
        excludeUserIds: [authResult.userId],
      });
    } catch (error: any) {
      console.error('[Resolve API] Failed to send push notifications:', error);
    }

    const updatedEvent = await db.events.get(event_id);

    return NextResponse.json({
      ...updatedEvent,
      cancelled: true,
      settlement,
    });
  }

  // Settle the money first, then mark the event resolved — never the other
  // way round. If we marked it resolved first and settlement then failed,
  // the stakes would be stranded in escrow on an event nobody can resolve
  // again. In this order the worst case is money correctly paid out on an
  // event that is still 'active', which a retry fixes (a second
  // settleCashEvent finds no held holds and returns a no_holds noop, so it
  // cannot double-pay).
  // settleCashEvent now settles WHICHEVER currency the event's payment_type
  // selects (usd for 'cash', the W for 'none') — see
  // lib/payments.ts's currencyForEvent. It is called unconditionally: an
  // event with no held escrow at all (a legacy play event whose bets predate
  // the W, or one that genuinely has zero bets) finds nothing to settle and
  // returns a no_holds noop, which is exactly the "pure bookkeeping, never
  // touches a wallet" behavior those bets must keep.
  let settlement: SettleCashEventResult;
  try {
    settlement = await settleCashEvent(event_id, winning_side);
  } catch (error: any) {
    if (isPaymentError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...error.details },
        { status: error.status }
      );
    }
    console.error('[Resolve API] Failed to settle event:', error);
    return NextResponse.json({ error: 'Failed to settle event' }, { status: 500 });
  }

  // A refunded settlement (nobody bet the winning side) makes every player
  // whole, so there are no winners or losers to record. calculateNetResults
  // would report a full loss for everyone here, contradicting the refund.
  const refunded = settlement?.mode === 'refund';

  const bets = await db.bets.getByEvent(event_id);
  const netResults = refunded ? [] : calculateNetResults(bets, winning_side);

  // Update leaderboard stats — applies to free AND cash events. All wallet
  // crediting is owned by the payments engine now (settleCashEvent above).
  if (!refunded) {
    for (const result of netResults) {
      const user = await db.users.get(result.user_id);
      if (user) {
        const newTotal = Math.round((user.net_total + result.net) * 100) / 100;
        const newStreak = result.net > 0 ? user.streak + 1 : 0;
        await db.users.update(result.user_id, {
          net_total: newTotal,
          streak: newStreak,
        });
      }
    }
  }

  const resolved_at = Date.now();

  await db.events.update(event_id, {
    status: 'resolved',
    resolution: {
      winning_side,
      resolved_at,
    },
  });

  // Close the race window between the settlement above and this status
  // update: placeCashBet only rejects bets on a resolved event, so a bet
  // that committed in between would leave a 'held' hold stranded on an
  // event nobody can settle again. Now that the event is resolved no new
  // hold can appear, so one more sweep is enough. It is a no_holds noop in
  // the normal case, and it cannot double-pay — settleCashEvent only ever
  // touches holds still in 'held'. Runs for every event now (usd or wp),
  // same reasoning as the initial settlement call above.
  try {
    const sweep = await settleCashEvent(event_id, winning_side);
    if (sweep.holds_settled > 0) {
      console.warn(`[Resolve API] Swept ${sweep.holds_settled} late hold(s) on ${event_id} settled after resolution`);
    }
  } catch (error: any) {
    console.error('[Resolve API] Post-resolution escrow sweep failed:', error);
  }

  // Add to activity feed
  const activityData = {
    type: 'resolution' as const,
    timestamp: resolved_at,
    event_id,
    event_title: event.title,
    username: 'System',
    winning_side,
  };

  try {
    await db.activities.add(activityData);
  } catch (error: any) {
    console.error('[Resolve API] Failed to add to activity feed:', error);
  }

  // Send push notification
  try {
    await notifyEventAudience({
      eventId: event_id,
      category: 'resolutions',
      payload: {
        title: '🏆 Event Resolved!',
        body: `"${event.title}" - Winner: ${winning_side}`,
        url: `/events/${event_id}`,
        eventId: event_id,
        tag: `resolution-${event_id}`,
      },
      excludeUserIds: [authResult.userId],
    });
  } catch (error: any) {
    console.error('[Resolve API] Failed to send push notifications:', error);
  }

  const updatedEvent = await db.events.get(event_id);

  return NextResponse.json({
    ...updatedEvent,
    net_results: netResults,
    settlement,
  });
}
