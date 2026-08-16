import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { db } from '@/lib/db';
import { calculateNetResults } from '@/lib/utils';
import { requireAuth } from '@/lib/auth';
import { getGroupResolver } from '@/lib/group-resolver';
import { reverseCashSettlement, isPaymentError, type ReverseCashSettlementResult } from '@/lib/payments';

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const { event_id } = body;

  if (!event_id) {
    return NextResponse.json({ error: 'Event ID is required' }, { status: 400 });
  }

  const event = await db.events.get(event_id);
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const group = await db.groups.get(event.group_id);
  const requiresResolver = event.payment_type === 'cash' || (group && !group.is_public);

  if (requiresResolver) {
    const resolver = await getGroupResolver(event.group_id);
    if (!resolver || resolver.user_id !== authResult.userId) {
      return NextResponse.json({ error: 'Only the chosen resolver can unresolve paid group events' }, { status: 403 });
    }
  } else {
    // Only group admins can unresolve free/public events
    const isAdmin = await db.groupMembers.isAdmin(event.group_id, authResult.userId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Only group admins can unresolve events' }, { status: 403 });
    }
  }

  // A cancelled event is `status === 'resolved'` with no `resolution` — that
  // is a valid unresolve target, not an error. Only a non-resolved event
  // (still active) is rejected here.
  if (event.status !== 'resolved') {
    return NextResponse.json({ error: 'Event is not resolved' }, { status: 400 });
  }

  // Reverse the money first. reverseCashSettlement is a no-op (already_reversed:
  // true) for free events, so it's safe to call unconditionally.
  let reversal: ReverseCashSettlementResult;
  try {
    reversal = await reverseCashSettlement(event_id);
  } catch (error: any) {
    if (isPaymentError(error) && error.code === 'REVERSAL_BLOCKED') {
      return NextResponse.json(
        { error: error.message, code: error.code, ...error.details },
        { status: 409 }
      );
    }
    console.error('[Unresolve API] Failed to reverse payouts:', error);
    return NextResponse.json({ error: 'Failed to reverse payouts' }, { status: 500 });
  }

  // Only reverse the leaderboard stats when a resolution actually applied
  // some — a cancelled event never touched net_total/streak, so reversing
  // one here would corrupt them.
  if (event.resolution) {
    const bets = await db.bets.getByEvent(event_id);
    const netResults = calculateNetResults(bets, event.resolution.winning_side);

    for (const result of netResults) {
      const user = await db.users.get(result.user_id);
      if (user) {
        // Reverse the net total change
        const newTotal = Math.round((user.net_total - result.net) * 100) / 100;
        // Reset streak to 0 since we can't accurately restore it
        // The streak will rebuild naturally as future events resolve
        await db.users.update(result.user_id, {
          net_total: newTotal,
          streak: 0,
        });
      }
    }
  }

  // Remove resolution
  await db.events.update(event_id, {
    status: 'active',
    resolution: undefined,
  });
  // db.events.update skips the winning_side/resolved_at clear when
  // `resolution` is `undefined` (it checks `!== undefined`), so clear them
  // explicitly here — otherwise a re-resolve wouldn't start clean.
  await sql`UPDATE events SET winning_side = NULL, resolved_at = NULL WHERE id = ${event_id}`;

  const updatedEvent = await db.events.get(event_id);

  return NextResponse.json({
    ...updatedEvent,
    reversal,
  });
}
