import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { Event, Bet, PaymentType } from '@/lib/types';
import { requireAuthUser } from '@/lib/auth';
import { syncUser } from '@/lib/sync-user';
import { notifyEventAudience, applySubjectPrivacy } from '@/lib/push';
import { placeCashBet, isPaymentError, MAX_TRANSACTION_AMOUNT } from '@/lib/payments';
import { createShareToken, shareUrlFor, buildEventPreview } from '@/lib/imessage-share';

export const dynamic = 'force-dynamic';

/**
 * Compose-and-send from the native iMessage extension: creates a wager and,
 * optionally, immediately places the creator's own bet on it — mirroring
 * POST /api/events + POST /api/bets in a single round trip, since the
 * extension's compose sheet has no separate "place a bet" step.
 *
 * Identity comes ONLY from the authenticated session (requireAuthUser +
 * syncUser) — never from the request body. `creator_user_id`-style body
 * fields do not exist on this route on purpose: a previous node closed an
 * unauthenticated-write hole in lib/auth.ts, and trusting a body-supplied id
 * here would reopen an equivalent one.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const syncResult = await syncUser(authResult.user);
  if (!syncResult.ok) {
    return NextResponse.json({ error: syncResult.error }, { status: syncResult.status });
  }
  const creatorId = syncResult.user.id;
  const creatorUsername = syncResult.user.username;

  const body = await request.json();
  const {
    group_id,
    title,
    side_a,
    side_b,
    end_time,
    payment_type: rawPaymentType,
    stake_amount: rawStakeAmount,
    subject_user_id,
    notify_subject,
    side,
    amount,
  } = body;

  // ---- Basic field validation --------------------------------------------
  const trimmedTitle = typeof title === 'string' ? title.trim() : '';
  const trimmedSideA = typeof side_a === 'string' ? side_a.trim() : '';
  const trimmedSideB = typeof side_b === 'string' ? side_b.trim() : '';

  if (!group_id || typeof group_id !== 'string') {
    return NextResponse.json({ error: 'group_id is required' }, { status: 400 });
  }
  if (!trimmedTitle || !trimmedSideA || !trimmedSideB) {
    return NextResponse.json({ error: 'title, side_a and side_b are required' }, { status: 400 });
  }
  if (trimmedSideA === trimmedSideB) {
    return NextResponse.json({ error: 'side_a and side_b must be different' }, { status: 400 });
  }
  if (typeof end_time !== 'number' || !Number.isFinite(end_time) || end_time <= Date.now()) {
    return NextResponse.json({ error: 'end_time must be a timestamp in the future' }, { status: 400 });
  }

  let payment_type: PaymentType = 'none';
  if (rawPaymentType !== undefined && rawPaymentType !== null) {
    if (rawPaymentType !== 'none' && rawPaymentType !== 'cash') {
      return NextResponse.json({ error: 'payment_type must be "none" or "cash"' }, { status: 400 });
    }
    payment_type = rawPaymentType;
  }

  // stake_amount === null means "each bettor picks their own" — only a
  // provided positive number pins the event to a fixed stake.
  let stake_amount: number | null = null;
  if (payment_type === 'cash' && rawStakeAmount !== undefined && rawStakeAmount !== null) {
    const parsedStake = Math.round(parseFloat(rawStakeAmount) * 100) / 100;
    if (!Number.isFinite(parsedStake) || !(parsedStake > 0)) {
      return NextResponse.json({ error: 'Stake must be greater than $0' }, { status: 400 });
    }
    if (parsedStake > MAX_TRANSACTION_AMOUNT) {
      return NextResponse.json({ error: `Maximum stake is $${MAX_TRANSACTION_AMOUNT}` }, { status: 400 });
    }
    stake_amount = parsedStake;
  }

  // ---- Group membership ----------------------------------------------------
  const group = await db.groups.get(group_id);
  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }
  // db.groupMembers.isMember already filters on status = 'active'.
  const callerIsMember = await db.groupMembers.isMember(group_id, creatorId);
  if (!callerIsMember) {
    return NextResponse.json(
      { error: 'You must be an active member of this group to create wagers' },
      { status: 403 }
    );
  }

  // ---- Subject (subject-privacy feature owned by a sibling node — just
  // validate + pass through, no behaviour is built on top of it here) ------
  let subjectUserId: string | null = null;
  if (subject_user_id !== undefined && subject_user_id !== null) {
    if (typeof subject_user_id !== 'string' || !subject_user_id) {
      return NextResponse.json({ error: 'subject_user_id must be a user id' }, { status: 400 });
    }
    const subjectUser = await db.users.get(subject_user_id);
    if (!subjectUser) {
      return NextResponse.json({ error: 'subject_user_id must be a real user' }, { status: 400 });
    }
    const subjectIsMember = await db.groupMembers.isMember(group_id, subject_user_id);
    if (!subjectIsMember) {
      return NextResponse.json(
        { error: 'subject_user_id must be an active member of this group' },
        { status: 400 }
      );
    }
    subjectUserId = subject_user_id;
  }
  // `null`/omitted means "not specified", same as app/api/events/route.ts —
  // only an explicit `false` suppresses the subject's notification.
  const notifySubject: boolean = notify_subject === undefined || notify_subject === null ? true : !!notify_subject;

  // ---- Validate the optional immediate bet BEFORE writing anything, so a
  // bad `side`/`amount` never causes a create-then-delete round trip -------
  let initialSide: string | null = null;
  let initialAmount: number | null = null;
  if (side !== undefined && side !== null) {
    if (typeof side !== 'string' || (side !== trimmedSideA && side !== trimmedSideB)) {
      return NextResponse.json({ error: 'side must match side_a or side_b' }, { status: 400 });
    }
    initialSide = side;
    initialAmount = typeof amount === 'number' && Number.isFinite(amount) ? amount : null;
    if (initialAmount === null && payment_type === 'cash' && stake_amount !== null) {
      // Fixed-stake cash event: the creator's own bet defaults to the stake.
      initialAmount = stake_amount;
    }
    if (initialAmount === null) {
      return NextResponse.json({ error: 'amount is required when side is provided' }, { status: 400 });
    }
  }

  // ---- Create the event -----------------------------------------------------
  const newEvent: Event = {
    id: generateId(),
    title: trimmedTitle,
    side_a: trimmedSideA,
    side_b: trimmedSideB,
    end_time,
    group_id,
    status: 'active',
    payment_type,
    stake_amount,
    subject_user_id: subjectUserId,
    notify_subject: notifySubject,
  };
  await db.events.create(newEvent);

  await applySubjectPrivacy(newEvent.id, subjectUserId, notifySubject);

  // ---- Optional immediate bet from the creator -------------------------------
  // DECISION: "create the event" and "place the creator's opening bet" are one
  // action from the iMessage composer's point of view. If placing the bet
  // fails after the event already exists (insufficient funds, fixed-stake
  // mismatch, etc.), we roll back by deleting the just-created event and
  // return the error, rather than returning 201 with a `bet_error` field.
  // Reasoning: a wager with no owner stake and no group notification isn't a
  // useful partial success, and atomic all-or-nothing keeps the client's
  // error handling simple (one failure path instead of two).
  let placedBet: Bet | null = null;
  if (initialSide !== null && initialAmount !== null) {
    if (payment_type === 'cash') {
      try {
        const result = await placeCashBet({
          eventId: newEvent.id,
          userId: creatorId,
          username: creatorUsername,
          side: initialSide,
          amount: initialAmount,
        });
        placedBet = result.bet;
      } catch (error: any) {
        await db.events.delete(newEvent.id);
        if (isPaymentError(error)) {
          return NextResponse.json(
            { error: error.message, code: error.code, ...error.details },
            { status: error.status }
          );
        }
        console.error('[iMessage bets] Failed to place creator cash bet:', error);
        return NextResponse.json({ error: 'Failed to place bet' }, { status: 500 });
      }
    } else {
      const timestamp = Date.now();
      const isLate = timestamp > newEvent.end_time;
      const parsedAmount = Math.round(initialAmount * 100) / 100;
      if (!(parsedAmount > 0)) {
        await db.events.delete(newEvent.id);
        return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 });
      }
      const bet: Bet = {
        id: generateId(),
        event_id: newEvent.id,
        user_id: creatorId,
        username: creatorUsername,
        side: initialSide,
        amount: parsedAmount,
        timestamp,
        is_late: isLate,
      };
      await db.bets.create(bet);
      placedBet = bet;
    }

    // Update creator's total_bet (only non-late bets count toward stats) —
    // mirrors both the cash and free branches of app/api/bets/route.ts.
    if (placedBet && !placedBet.is_late) {
      const user = await db.users.get(creatorId);
      if (user) {
        await db.users.update(creatorId, {
          total_bet: Math.round((user.total_bet + placedBet.amount) * 100) / 100,
        });
      }
    }
  }

  // ---- Activity feed (best-effort — never fails the request) ----------------
  try {
    await db.activities.add({
      type: 'event_created',
      timestamp: Date.now(),
      event_id: newEvent.id,
      event_title: newEvent.title,
      user_id: creatorId,
      username: creatorUsername,
    });
    if (placedBet) {
      await db.activities.add({
        type: 'bet',
        timestamp: placedBet.timestamp,
        event_id: newEvent.id,
        event_title: newEvent.title,
        user_id: creatorId,
        username: creatorUsername,
        side: placedBet.side,
        amount: placedBet.amount,
      });
    }
  } catch (error) {
    console.error('[iMessage bets] Failed to add to activity feed:', error);
  }

  // ---- Push notification (best-effort), same shape as app/api/events/route.ts ----
  // Notify the group only — never the whole platform, never a hidden subject.
  try {
    const creatorText = ` by ${creatorUsername}`;
    const cashText =
      payment_type === 'cash'
        ? stake_amount !== null
          ? ` · $${stake_amount.toFixed(2)} stake`
          : ' · real money'
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
      excludeUserIds: [creatorId],
    });
  } catch (error) {
    console.error('[iMessage bets] Failed to send push notifications:', error);
  }

  // share_token may be null when IMESSAGE_SHARE_SECRET is unconfigured —
  // return null rather than faking a token that wouldn't verify.
  const shareToken = createShareToken(newEvent.id);
  const preview = buildEventPreview(newEvent, placedBet ? [placedBet] : [], true);

  return NextResponse.json(
    {
      event_id: newEvent.id,
      share_token: shareToken,
      share_url: shareUrlFor(newEvent.id, shareToken),
      preview,
    },
    { status: 201 }
  );
}
