import { NextRequest, NextResponse } from 'next/server';
import { creditStripeDeposit, failStripeDeposit } from '@/lib/payments';
import Stripe from 'stripe';

// The raw request body must reach us byte-for-byte for signature
// verification, so this route must never be statically optimized or run on
// the edge runtime.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(key);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  // Refuse to process anything without a configured webhook secret — no
  // database access may happen without a verified signature, and verifying
  // against an empty secret is not a signature check.
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  let event: Stripe.Event;

  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const userId = paymentIntent.metadata.user_id;
        const type = paymentIntent.metadata.type;

        if (type === 'deposit' && userId) {
          // Idempotent by Stripe event id: a redelivered event (Stripe
          // retries on any non-2xx, plus its own delivery schedule) credits
          // the wallet at most once.
          const result = await creditStripeDeposit({
            stripeEventId: event.id,
            paymentIntentId: paymentIntent.id,
            userId,
            amount: paymentIntent.amount / 100,
            description: `Deposit $${(paymentIntent.amount / 100).toFixed(2)}`,
          });

          console.log(
            `[Stripe Webhook] ${result.duplicate ? 'Duplicate delivery ignored' : 'Deposit credited'} for payment_intent ${paymentIntent.id} (event ${event.id})`
          );

          return NextResponse.json({ received: true, credited: result.credited, duplicate: result.duplicate });
        }

        console.log(`[Stripe Webhook] Ignoring payment_intent.succeeded without deposit metadata (${paymentIntent.id})`);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const result = await failStripeDeposit({
          stripeEventId: event.id,
          paymentIntentId: paymentIntent.id,
        });
        console.log(
          `[Stripe Webhook] ${result.updated ? 'Marked deposit failed' : 'No pending deposit found'} for payment_intent ${paymentIntent.id} (event ${event.id})`
        );
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    // Never swallow this into a 200 — that would silently lose a real
    // deposit. The engine's writes are idempotent, so letting Stripe retry
    // on a 500 is safe.
    console.error('[Stripe Webhook] Error processing event:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
