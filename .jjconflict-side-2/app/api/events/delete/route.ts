import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getGroupResolver } from '@/lib/group-resolver';

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

  // Same rule the resolve route uses: real-money events (and paid private
  // groups) belong to the chosen resolver, everything else to group admins.
  const group = await db.groups.get(event.group_id);
  const requiresResolver = event.payment_type === 'cash' || (group !== null && !group.is_public);

  if (requiresResolver) {
    const resolver = await getGroupResolver(event.group_id);
    if (!resolver || resolver.user_id !== authResult.userId) {
      return NextResponse.json({ error: 'Only the chosen resolver can delete this event' }, { status: 403 });
    }
  } else {
    const isAdmin = await db.groupMembers.isAdmin(event.group_id, authResult.userId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Only group admins can delete events' }, { status: 403 });
    }
  }

  // escrow_holds cascade-delete with the event, so deleting an event that
  // still holds stakes would take the money out of players' wallets with no
  // way to give it back. Force the resolver through cancel-and-refund first.
  if (event.payment_type === 'cash') {
    const held = await db.escrowHolds.getHeldTotalForEvent(event_id);
    if (held > 0) {
      return NextResponse.json(
        {
          error: `This event still holds $${held.toFixed(2)} in escrow. Cancel it first to refund every stake, then delete it.`,
          code: 'ESCROW_OUTSTANDING',
          escrow_held: held,
        },
        { status: 400 }
      );
    }
  }

  // Delete the event (CASCADE will delete bets)
  await db.events.delete(event_id);

  return NextResponse.json({ success: true });
}
