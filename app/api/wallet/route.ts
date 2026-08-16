import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, verifyUserMatch } from '@/lib/auth';
import { generateId } from '@/lib/utils';
import { MAX_TRANSACTION_AMOUNT, withdrawFromWallet, getWalletSummary, isPaymentError } from '@/lib/payments';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(key);
}

// GET /api/wallet?userId=xxx&eventId=yyy — get wallet balance, recent
// transactions, and (optionally) an event-scoped escrow summary.
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const eventId = searchParams.get('eventId');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  const mismatch = verifyUserMatch(authResult.userId, userId);
  if (mismatch) return mismatch;

  const summary = await getWalletSummary(userId, eventId || undefined);
  const transactions = await db.transactions.getByUser(userId, 20);

  return NextResponse.json({
    wallet: summary.wallet,
    transactions,
    escrow_held_total: summary.escrow_held_total,
    available: summary.available,
    ...(summary.event ? { event: summary.event } : {}),
  });
}

// POST /api/wallet — deposit or withdraw
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const { user_id, action, amount, idempotency_key } = body;

  if (!user_id || !action || !amount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const mismatch = verifyUserMatch(authResult.userId, user_id);
  if (mismatch) return mismatch;

  // These two guards short-circuit before the payments engine, so they have
  // to carry the same machine-readable `code` the engine would have thrown —
  // clients branch on `code`, not on the message.
  const parsedAmount = Math.round(parseFloat(amount) * 100) / 100;
  if (!(parsedAmount > 0)) {
    return NextResponse.json({ error: 'Amount must be positive', code: 'INVALID_AMOUNT' }, { status: 400 });
  }

  if (parsedAmount > MAX_TRANSACTION_AMOUNT) {
    return NextResponse.json(
      { error: `Maximum transaction amount is $${MAX_TRANSACTION_AMOUNT}`, code: 'AMOUNT_TOO_LARGE' },
      { status: 400 }
    );
  }

  // Ensure wallet exists
  await db.wallets.getOrCreate(user_id);

  if (action === 'deposit') {
    try {
      // Create a Stripe Payment Intent. The idempotency key ensures a
      // retried request (double-click, client timeout + retry, etc.) can't
      // create two payment intents for the same deposit attempt.
      const stripe = getStripe();
      const stripeKey = `deposit:${user_id}:${idempotency_key ?? generateId()}`;
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: Math.round(parsedAmount * 100), // Stripe uses cents
          currency: 'usd',
          metadata: {
            user_id,
            type: 'deposit',
          },
        },
        { idempotencyKey: stripeKey }
      );

      // Record pending transaction, traceable back to this attempt via
      // idempotency_key. The webhook owns the `stripe:`-prefixed key
      // namespace, so we don't set one here.
      const transaction = {
        id: generateId(),
        user_id,
        type: 'deposit' as const,
        amount: parsedAmount,
        status: 'pending' as const,
        stripe_payment_intent_id: paymentIntent.id,
        description: `Deposit $${parsedAmount.toFixed(2)}`,
        idempotency_key: stripeKey,
      };

      await db.transactions.create(transaction);

      return NextResponse.json({
        clientSecret: paymentIntent.client_secret,
        transaction,
      });
    } catch (error: any) {
      console.error('[Wallet API] Stripe error:', error);
      if (error?.message?.includes('STRIPE_SECRET_KEY')) {
        return NextResponse.json({ error: 'Stripe is not configured. Add STRIPE_SECRET_KEY in Vercel.' }, { status: 500 });
      }
      return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
    }
  }

  if (action === 'withdraw') {
    try {
      const result = await withdrawFromWallet({
        userId: user_id,
        amount: parsedAmount,
        idempotencyKey: idempotency_key,
      });
      return NextResponse.json({ wallet: result.wallet, transaction: result.transaction, duplicate: result.duplicate });
    } catch (error) {
      if (isPaymentError(error)) {
        return NextResponse.json(
          { error: error.message, code: error.code, ...error.details },
          { status: error.status }
        );
      }
      console.error('[Wallet API] Withdrawal error:', error);
      return NextResponse.json({ error: 'Failed to process withdrawal' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Invalid action. Use "deposit" or "withdraw"' }, { status: 400 });
}
