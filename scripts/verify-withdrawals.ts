/**
 * Proves the refund-to-source withdrawal path in lib/payments.ts.
 *
 * Drives the REAL withdrawFromWallet / executeWithdrawalPayout / getWithdrawable
 * against the shared dev database, with only Stripe replaced by a recording
 * fake RefundGateway (no network, no real money). Every row it writes is
 * tagged with a run prefix and deleted in a finally block.
 *
 *   npm run verify:withdrawals      (needs POSTGRES_URL)
 *
 * What it proves, in order:
 *   1. Winnings are not withdrawable. House grants are not withdrawable.
 *      Only what you actually deposited comes back.
 *   2. The cap is min(balance, deposited - withdrawn), so losing money after
 *      depositing lowers what you can take out.
 *   3. A withdrawal debits the wallet and lands as ONE completed row whose
 *      amount matches the refunds actually created.
 *   4. Replaying the same idempotency key does not fire a second refund.
 *   5. Refund creation is keyed per (withdrawal, payment intent), so a retried
 *      payout re-requests the same refund instead of paying twice.
 *   6. When nothing is refundable the money goes BACK to the wallet and the
 *      row is marked failed, never left pending and never silently eaten.
 *   7. Concurrent withdrawals cannot both spend the same headroom.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { sql } from '@vercel/postgres';
import {
  withdrawFromWallet,
  executeWithdrawalPayout,
  getWithdrawable,
  isPaymentError,
  type RefundGateway,
} from '../lib/payments';

const RUN = `zzwd_${Date.now()}`;
const USER = `${RUN}_user`;

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Records every call so the test can assert on what Stripe would have seen. */
function fakeGateway(refundableByPi: Record<string, number>) {
  const calls: Array<{ pi: string; cents: number; key: string }> = [];
  const issued = new Map<string, string>(); // idempotencyKey -> refund id
  const gateway: RefundGateway = {
    async refundableCents(pi) {
      return refundableByPi[pi] ?? 0;
    },
    async createRefund({ paymentIntentId, amountCents, idempotencyKey }) {
      calls.push({ pi: paymentIntentId, cents: amountCents, key: idempotencyKey });
      // Real Stripe returns the ORIGINAL refund for a repeated idempotency
      // key rather than making a new one. Model that faithfully — it is the
      // property the payout path leans on.
      const existing = issued.get(idempotencyKey);
      if (existing) return { id: existing };
      const id = `re_${issued.size + 1}_${RUN}`;
      issued.set(idempotencyKey, id);
      return { id };
    },
  };
  return { gateway, calls, issued };
}

async function seedUser() {
  await sql`
    INSERT INTO users (id, username, display_name, created_at)
    VALUES (${USER}, ${USER}, 'Withdrawal Probe', NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO wallets (user_id, balance, wp_balance, currency)
    VALUES (${USER}, 0, 0, 'usd')
    ON CONFLICT (user_id) DO UPDATE SET balance = 0
  `;
}

async function addDeposit(piId: string, amount: number) {
  await sql`
    INSERT INTO transactions (id, user_id, type, amount, status, stripe_payment_intent_id, description, currency)
    VALUES (${`${RUN}_dep_${piId}`}, ${USER}, 'deposit', ${amount}, 'completed', ${piId}, ${`${RUN} deposit`}, 'usd')
  `;
  await sql`UPDATE wallets SET balance = balance + ${amount} WHERE user_id = ${USER}`;
}

/** Credit the wallet WITHOUT a deposit row — house money or winnings. */
async function creditWithoutDeposit(amount: number) {
  await sql`UPDATE wallets SET balance = balance + ${amount} WHERE user_id = ${USER}`;
}

async function balance(): Promise<number> {
  const r = await sql`SELECT balance FROM wallets WHERE user_id = ${USER}`;
  return Number(r.rows[0]?.balance ?? 0);
}

async function cleanup() {
  await sql`DELETE FROM transactions WHERE user_id = ${USER}`;
  await sql`DELETE FROM wallets WHERE user_id = ${USER}`;
  await sql`DELETE FROM users WHERE id = ${USER}`;
}

async function main() {
  console.log(`\nverify:withdrawals  (run ${RUN})\n`);
  await seedUser();

  // --- 1. house money and winnings are not withdrawable -------------------
  // The first getWithdrawable applies the real lazy $10 signup grant, which
  // lands as a type='deposit' row with NO payment intent. That row is the
  // whole reason the cap can't just sum deposits.
  let w = await getWithdrawable(USER);
  check('signup grant alone is not withdrawable', w.withdrawable === 0, `got ${w.withdrawable}`);
  check('  ...even though it credited the balance', w.balance === 10, `got ${w.balance}`);
  check('  ...and it is not counted as a deposit', w.deposited === 0, `got ${w.deposited}`);

  await creditWithoutDeposit(40); // winnings taken off other players
  w = await getWithdrawable(USER);
  check('winnings are not withdrawable either', w.withdrawable === 0, `got ${w.withdrawable}`);
  check('  ...with $50 sitting in the balance', w.balance === 50, `got ${w.balance}`);

  // --- 2. deposits raise the ceiling, losses lower it ---------------------
  await addDeposit(`pi_${RUN}_a`, 50);
  w = await getWithdrawable(USER);
  check('a $50 card deposit makes $50 withdrawable', w.withdrawable === 50, `got ${w.withdrawable}`);
  check('  ...even though the balance is $100', w.balance === 100, `got ${w.balance}`);

  // Lose $70 at the table: balance falls below what was deposited.
  await sql`UPDATE wallets SET balance = balance - 70 WHERE user_id = ${USER}`;
  w = await getWithdrawable(USER);
  check('cap follows the balance once money is lost', w.withdrawable === 30 && w.balance === 30, `withdrawable=${w.withdrawable} balance=${w.balance}`);

  // Put it back so the rest of the run has room to work with.
  await sql`UPDATE wallets SET balance = 70 WHERE user_id = ${USER}`;
  w = await getWithdrawable(USER);
  check('cap is min(balance, deposited - withdrawn)', w.withdrawable === 50, `got ${w.withdrawable}`);

  // --- 3. over-cap withdrawal is refused ---------------------------------
  let refused = false;
  try {
    await withdrawFromWallet({ userId: USER, amount: 60, idempotencyKey: `${RUN}_over` });
  } catch (e) {
    refused = isPaymentError(e) && e.code === 'EXCEEDS_WITHDRAWABLE';
  }
  check('withdrawing above the cap is refused', refused);
  check('  ...and refusing left the balance untouched', (await balance()) === 70, `got ${await balance()}`);

  // --- 4. a real withdrawal debits and refunds ---------------------------
  const g1 = fakeGateway({ [`pi_${RUN}_a`]: 5000 });
  const wd = await withdrawFromWallet({ userId: USER, amount: 20, idempotencyKey: `${RUN}_ok` });
  check('withdrawal debits the wallet immediately', (await balance()) === 50, `got ${await balance()}`);
  check('  ...and lands as a pending row', wd.transaction.status === 'pending', wd.transaction.status);

  const payout = await executeWithdrawalPayout({
    userId: USER,
    transactionId: wd.transaction.id,
    amount: 20,
    gateway: g1.gateway,
  });
  check('refund created for the full amount', g1.calls.length === 1 && g1.calls[0].cents === 2000, JSON.stringify(g1.calls));
  check('row is completed after payout', payout.transaction.status === 'completed', payout.transaction.status);
  check('nothing returned to the wallet', payout.returnedToWallet === 0, `got ${payout.returnedToWallet}`);
  check('balance unchanged by the payout step', (await balance()) === 50, `got ${await balance()}`);

  w = await getWithdrawable(USER);
  check('withdrawn amount is deducted from the ceiling', w.withdrawable === 30, `got ${w.withdrawable}`);

  // --- 5. replaying the payout does not pay twice ------------------------
  const before = g1.issued.size;
  await executeWithdrawalPayout({
    userId: USER,
    transactionId: wd.transaction.id,
    amount: 20,
    gateway: g1.gateway,
  });
  check('replayed payout issues no new refund', g1.issued.size === before, `${before} -> ${g1.issued.size}`);
  check('  ...and does not move the balance', (await balance()) === 50, `got ${await balance()}`);

  // --- 6. duplicate withdrawal request is a no-op ------------------------
  const dup = await withdrawFromWallet({ userId: USER, amount: 20, idempotencyKey: `${RUN}_ok` });
  check('same idempotency key returns the original', dup.duplicate === true);
  check('  ...and does not debit again', (await balance()) === 50, `got ${await balance()}`);

  // --- 7. nothing refundable => money goes back, row marked failed -------
  const g2 = fakeGateway({}); // Stripe says: nothing left to refund anywhere
  const doomed = await withdrawFromWallet({ userId: USER, amount: 25, idempotencyKey: `${RUN}_doomed` });
  check('doomed withdrawal debited first', (await balance()) === 25, `got ${await balance()}`);
  let threw = false;
  try {
    await executeWithdrawalPayout({
      userId: USER,
      transactionId: doomed.transaction.id,
      amount: 25,
      gateway: g2.gateway,
    });
  } catch (e) {
    threw = isPaymentError(e) && e.code === 'PAYOUT_FAILED';
  }
  check('unpayable withdrawal throws PAYOUT_FAILED', threw);
  check('  ...and the money is back in the wallet', (await balance()) === 50, `got ${await balance()}`);
  check('  ...and zero refunds were attempted', g2.calls.length === 0, JSON.stringify(g2.calls));
  const doomedRow = await sql`SELECT status FROM transactions WHERE id = ${doomed.transaction.id}`;
  check('  ...and the row reads failed, not pending', doomedRow.rows[0]?.status === 'failed', String(doomedRow.rows[0]?.status));
  w = await getWithdrawable(USER);
  check('  ...and a failed row frees its headroom again', w.withdrawable === 30, `got ${w.withdrawable}`);

  // --- 8. concurrent withdrawals cannot both spend the headroom ---------
  const results = await Promise.allSettled([
    withdrawFromWallet({ userId: USER, amount: 30, idempotencyKey: `${RUN}_race_a` }),
    withdrawFromWallet({ userId: USER, amount: 30, idempotencyKey: `${RUN}_race_b` }),
  ]);
  const ok = results.filter(r => r.status === 'fulfilled').length;
  check('exactly one of two racing $30 withdrawals wins', ok === 1, `${ok} succeeded`);
  check('  ...and the wallet is not overdrawn', (await balance()) >= 0, `got ${await balance()}`);

  // --- 9. a payout spanning two deposits allocates across both ----------
  await sql`DELETE FROM transactions WHERE user_id = ${USER} AND type = 'withdrawal'`;
  await sql`UPDATE wallets SET balance = 100 WHERE user_id = ${USER}`;
  await addDeposit(`pi_${RUN}_b`, 0.01); // keeps deposit history multi-intent
  const g3 = fakeGateway({ [`pi_${RUN}_a`]: 1000, [`pi_${RUN}_b`]: 1500 });
  const multi = await withdrawFromWallet({ userId: USER, amount: 22, idempotencyKey: `${RUN}_multi` });
  const multiPayout = await executeWithdrawalPayout({
    userId: USER,
    transactionId: multi.transaction.id,
    amount: 22,
    gateway: g3.gateway,
  });
  const totalCents = g3.calls.reduce((s, c) => s + c.cents, 0);
  check('multi-intent payout refunds across both intents', g3.calls.length === 2, JSON.stringify(g3.calls));
  check('  ...summing to the requested amount', totalCents === 2200, `got ${totalCents}`);
  check('  ...with one idempotency key per intent', new Set(g3.calls.map(c => c.key)).size === 2);
  check('  ...and completes the row', multiPayout.transaction.status === 'completed', multiPayout.transaction.status);
}

main()
  .catch((err) => {
    failed++;
    console.error('\nUNCAUGHT:', err);
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error('cleanup failed:', e));
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
  });
