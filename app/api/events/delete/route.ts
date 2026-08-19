import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { formatCurrencyAmount } from '@/lib/payments';

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

  // R2/R3: same rule as resolve/unresolve — only the event's creator may
  // delete it (fallback: the group's creator, for legacy events with no
  // created_by). Admin-role gating retired along with group-resolver.ts's
  // role in this decision — see that file's header comment.
  const group = await db.groups.get(event.group_id);
  const resolverUserId = event.created_by ?? group?.created_by ?? null;
  if (!resolverUserId || resolverUserId !== authResult.userId) {
    return NextResponse.json({ error: 'Only the event creator can delete this event' }, { status: 403 });
  }

  // escrow_holds cascade-delete with the event, so deleting an event that
  // still holds stakes would take the money out of players' wallets with no
  // way to give it back. Force the resolver through cancel-and-refund
  // first. Checked for every payment_type — every event stakes usd through
  // the same escrow engine now (payment_type no longer selects a ledger);
  // an event with no escrow at all is a harmless 0-held no-op here.
  const held = await db.escrowHolds.getHeldTotalForEvent(event_id);
  if (held > 0) {
    return NextResponse.json(
      {
        error: `This event still holds ${formatCurrencyAmount(held)} in escrow. Cancel it first to refund every stake, then delete it.`,
        code: 'ESCROW_OUTSTANDING',
        escrow_held: held,
      },
      { status: 400 }
    );
  }

  // Delete the event (CASCADE will delete bets)
  await db.events.delete(event_id);

  return NextResponse.json({ success: true });
}
