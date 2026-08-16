import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyShareToken, buildEventPreview } from '@/lib/imessage-share';

export const dynamic = 'force-dynamic';

/**
 * PUBLIC, unauthenticated preview used to render the iMessage message
 * bubble (and any other "here's what this wager is" surface) for people who
 * may not be signed in yet. Because it's public, it must disclose as little
 * as possible:
 *
 * - Always public: title, both side labels, end_time, status, winning_side,
 *   payment_type, stake_amount, and aggregate counts.
 * - side_a_total / side_b_total (money) are ONLY included once a valid
 *   share token proves the caller actually received this event's bubble —
 *   otherwise they're null.
 * - NEVER returned, under any circumstances: usernames, individual bets,
 *   notes, the group id/name, `description`, or `subject_user_id` /
 *   `notify_subject`. The latter two belong to a sibling "quiet bet"
 *   subject-privacy feature — leaking either one here (even just their
 *   presence) would defeat the whole point of that feature, since it would
 *   let anyone with the event id discover a bet exists "about" someone even
 *   when notifications were suppressed. buildEventPreview() never puts
 *   those fields on the response object in the first place, so there's
 *   nothing here that could accidentally spread them through.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const token = searchParams.get('t');

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const event = await db.events.get(id);
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const includeTotals = verifyShareToken(id, token);
  const bets = await db.bets.getByEvent(id);
  const preview = buildEventPreview(event, bets, includeTotals);

  return NextResponse.json(preview, {
    headers: {
      // A valid token widened this response with money totals — that
      // response must never be cached/shared with a differently-tokened (or
      // token-less) request for the same id.
      'Cache-Control': includeTotals ? 'no-store' : 'public, s-maxage=5, stale-while-revalidate=30',
    },
  });
}
