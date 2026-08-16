import { sql, type VercelPoolClient } from '@vercel/postgres';
import { withTransaction, db } from './db';
import { generateId } from './utils';
import type { Wallet, Transaction, EscrowHold, Bet } from './types';

export const MAX_TRANSACTION_AMOUNT = 500;

export type PaymentErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'NOT_CASH_EVENT'
  | 'EVENT_NOT_FOUND'
  | 'EVENT_CLOSED'
  | 'EVENT_RESOLVED'
  | 'EVENT_NOT_RESOLVED'
  | 'INVALID_STAKE'
  | 'AMOUNT_TOO_LARGE'
  | 'REVERSAL_BLOCKED';

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: PaymentErrorCode, message: string, status: number = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.status = status;
    this.details = details;
    // tsconfig sets no `target`, so transpiled `class ... extends Error`
    // subclasses don't reliably satisfy `instanceof` across compilation
    // targets — restore the prototype chain explicitly.
    Object.setPrototypeOf(this, PaymentError.prototype);
  }
}

// Prefer this over a bare `instanceof PaymentError` check at API boundaries
// (e.g. route handlers deciding on a status code): it still works even if
// the error crossed a serialization boundary or an `instanceof` check
// against a differently-compiled copy of this class would otherwise fail.
export function isPaymentError(e: unknown): e is PaymentError {
  return (
    e instanceof PaymentError ||
    (typeof e === 'object' && e !== null && (e as any).name === 'PaymentError' && typeof (e as any).code === 'string')
  );
}

// Round to 2dp via integer cents so repeated arithmetic never drifts off the
// float grid (e.g. 0.1 + 0.2 !== 0.3).
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

// ---- row mappers (mirrors lib/db.ts's private mapX helpers, since those
// aren't exported and this file must run its own tx.sql statements) --------

function mapWallet(row: any): Wallet {
  return {
    user_id: row.user_id,
    balance: parseFloat(row.balance),
    currency: row.currency,
    updated_at: row.updated_at,
  };
}

function mapTransaction(row: any): Transaction {
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    amount: parseFloat(row.amount),
    status: row.status,
    stripe_payment_intent_id: row.stripe_payment_intent_id || undefined,
    description: row.description || undefined,
    created_at: row.created_at,
    idempotency_key: row.idempotency_key ?? null,
    event_id: row.event_id ?? null,
  };
}

function mapEscrowHold(row: any): EscrowHold {
  return {
    id: row.id,
    event_id: row.event_id,
    bet_id: row.bet_id ?? null,
    user_id: row.user_id,
    amount: parseFloat(row.amount),
    status: row.status,
    created_at: row.created_at,
    released_at: row.released_at ?? null,
  };
}

function mapBet(row: any): Bet {
  return {
    id: row.id,
    event_id: row.event_id,
    user_id: row.user_id,
    username: row.username,
    side: row.side,
    amount: parseFloat(row.amount),
    note: row.note || undefined,
    is_late: row.is_late,
    timestamp: parseInt(row.timestamp),
    escrow_hold_id: row.escrow_hold_id ?? null,
  };
}

// Ensures a wallet row exists, then locks it FOR UPDATE and returns the
// locked row. Callers must be inside a withTransaction.
async function lockOrCreateWallet(tx: VercelPoolClient, userId: string): Promise<{ balance: number }> {
  await tx.sql`
    INSERT INTO wallets (user_id, balance, currency)
    VALUES (${userId}, 0, 'usd')
    ON CONFLICT (user_id) DO NOTHING
  `;
  const result = await tx.sql`SELECT balance FROM wallets WHERE user_id = ${userId} FOR UPDATE`;
  return { balance: parseFloat(result.rows[0].balance) };
}

// Guarded credit: creates the wallet row if missing, then adds `amountCents`.
// Callers are expected to have already established a deterministic lock
// order (ascending user_id) across the whole settlement to avoid deadlocks.
async function creditWalletCents(tx: VercelPoolClient, userId: string, amountCents: number): Promise<Wallet> {
  const amount = fromCents(amountCents);
  await tx.sql`
    INSERT INTO wallets (user_id, balance, currency)
    VALUES (${userId}, 0, 'usd')
    ON CONFLICT (user_id) DO NOTHING
  `;
  const result = await tx.sql`
    UPDATE wallets
    SET balance = balance + ${amount}, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return mapWallet(result.rows[0]);
}

// What the debit is for, so the INSUFFICIENT_FUNDS message reads correctly
// regardless of which flow triggered it — debitWalletGuarded is shared by
// placeCashBet, withdrawFromWallet, and reverseCashSettlement.
type DebitContext = 'bet' | 'withdrawal' | 'reversal';

const DEBIT_CONTEXT_LABEL: Record<DebitContext, string> = {
  bet: 'this bet',
  withdrawal: 'this withdrawal',
  reversal: 'this reversal',
};

// Guarded debit: throws INSUFFICIENT_FUNDS (rather than relying on the DB
// CHECK constraint) when the balance would go negative.
async function debitWalletGuarded(
  tx: VercelPoolClient,
  userId: string,
  amount: number,
  context: DebitContext
): Promise<Wallet> {
  const result = await tx.sql`
    UPDATE wallets
    SET balance = balance - ${amount}, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ${userId} AND balance >= ${amount}
    RETURNING *
  `;
  if (result.rows.length === 0) {
    const existing = await tx.sql`SELECT balance FROM wallets WHERE user_id = ${userId}`;
    const balance = existing.rows.length > 0 ? parseFloat(existing.rows[0].balance) : 0;
    throw new PaymentError(
      'INSUFFICIENT_FUNDS',
      `Insufficient balance. You have $${balance.toFixed(2)} but ${DEBIT_CONTEXT_LABEL[context]} needs $${amount.toFixed(2)}.`,
      400,
      { balance, required: amount, shortfall: roundMoney(amount - balance) }
    );
  }
  return mapWallet(result.rows[0]);
}

// ---- placing a bet on a cash event -------------------------------------

export interface PlaceCashBetInput {
  eventId: string;
  userId: string;
  username: string;
  side: string;
  amount: number;
  note?: string;
}

export interface PlaceCashBetResult {
  bet: Bet;
  hold: EscrowHold;
  transaction: Transaction;
  wallet: Wallet;
}

export async function placeCashBet(input: PlaceCashBetInput): Promise<PlaceCashBetResult> {
  return withTransaction(async (tx) => {
    const eventResult = await tx.sql`SELECT * FROM events WHERE id = ${input.eventId} FOR UPDATE`;
    if (eventResult.rows.length === 0) {
      throw new PaymentError('EVENT_NOT_FOUND', 'Event not found.', 404);
    }
    const event = eventResult.rows[0];

    if (event.payment_type !== 'cash') {
      throw new PaymentError('NOT_CASH_EVENT', 'This event does not use real-money betting.', 400);
    }
    if (event.status !== 'active') {
      throw new PaymentError('EVENT_RESOLVED', 'This event has already been resolved.', 400);
    }
    if (Date.now() > parseInt(event.end_time)) {
      throw new PaymentError('EVENT_CLOSED', 'Betting closed for this event.', 400);
    }

    const fixedStake = event.stake_amount !== null && event.stake_amount !== undefined
      ? parseFloat(event.stake_amount)
      : null;

    let stake: number;
    if (fixedStake !== null && fixedStake > 0) {
      if (roundMoney(input.amount) !== roundMoney(fixedStake)) {
        throw new PaymentError(
          'INVALID_STAKE',
          `This event has a fixed stake of $${fixedStake.toFixed(2)}.`,
          400,
          { required_stake: fixedStake }
        );
      }
      stake = roundMoney(fixedStake);
    } else {
      stake = roundMoney(input.amount);
      if (!(stake > 0)) {
        throw new PaymentError('INVALID_STAKE', 'Stake must be greater than $0.', 400);
      }
      if (stake > MAX_TRANSACTION_AMOUNT) {
        throw new PaymentError(
          'AMOUNT_TOO_LARGE',
          `Maximum transaction amount is $${MAX_TRANSACTION_AMOUNT}`,
          400
        );
      }
    }

    const { balance } = await lockOrCreateWallet(tx, input.userId);
    if (balance < stake) {
      // Nothing has been written yet — throwing here rolls the whole
      // transaction back, which is the point (no partial holds/debits).
      throw new PaymentError(
        'INSUFFICIENT_FUNDS',
        `Insufficient balance. You have $${balance.toFixed(2)} but this bet needs $${stake.toFixed(2)}.`,
        400,
        { balance, required: stake, shortfall: roundMoney(stake - balance) }
      );
    }

    // Guarded UPDATE is the race-loser path: another concurrent debit could
    // have won between the balance read above and this statement.
    const wallet = await debitWalletGuarded(tx, input.userId, stake, 'bet');

    const holdId = generateId();
    const holdResult = await tx.sql`
      INSERT INTO escrow_holds (id, event_id, bet_id, user_id, amount, status)
      VALUES (${holdId}, ${input.eventId}, NULL, ${input.userId}, ${stake}, 'held')
      RETURNING *
    `;
    const hold = mapEscrowHold(holdResult.rows[0]);

    const transactionId = generateId();
    const txnResult = await tx.sql`
      INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, event_id)
      VALUES (
        ${transactionId},
        ${input.userId},
        'escrow_hold',
        ${-stake},
        'completed',
        ${`Stake on "${input.side}" — ${event.title}`},
        ${`bet:${holdId}`},
        ${input.eventId}
      )
      RETURNING *
    `;
    const transaction = mapTransaction(txnResult.rows[0]);

    const betId = generateId();
    const timestamp = Date.now();
    const betResult = await tx.sql`
      INSERT INTO bets (id, event_id, user_id, username, side, amount, note, is_late, timestamp, escrow_hold_id)
      VALUES (
        ${betId},
        ${input.eventId},
        ${input.userId},
        ${input.username},
        ${input.side},
        ${stake},
        ${input.note || null},
        false,
        ${timestamp},
        ${holdId}
      )
      RETURNING *
    `;
    const bet = mapBet(betResult.rows[0]);

    await tx.sql`UPDATE escrow_holds SET bet_id = ${betId} WHERE id = ${holdId}`;
    hold.bet_id = betId;

    return { bet, hold, transaction, wallet };
  });
}

// ---- settling ------------------------------------------------------------

export interface SettlementPayout {
  user_id: string;
  stake: number;
  gross: number;
  net_winnings: number;
}

export interface SettlementRefund {
  user_id: string;
  amount: number;
}

export interface SettleCashEventResult {
  mode: 'payout' | 'refund' | 'noop';
  reason?: 'no_winners' | 'no_holds' | 'cancelled';
  pot: number;
  payouts: SettlementPayout[];
  refunds: SettlementRefund[];
  holds_settled: number;
}

export async function settleCashEvent(eventId: string, winningSide: string | null): Promise<SettleCashEventResult> {
  return withTransaction(async (tx) => {
    const eventResult = await tx.sql`SELECT * FROM events WHERE id = ${eventId} FOR UPDATE`;
    if (eventResult.rows.length === 0) {
      throw new PaymentError('EVENT_NOT_FOUND', 'Event not found.', 404);
    }
    const event = eventResult.rows[0];

    if (event.payment_type !== 'cash') {
      // Free events move no money — this must be a safe no-op so callers
      // don't need to branch on payment_type before settling.
      return { mode: 'noop', pot: 0, payouts: [], refunds: [], holds_settled: 0 };
    }

    // Settlement generation number: resolve -> unresolve (reverseCashSettlement)
    // -> resolve again must NOT collide with the first settlement's
    // idempotency keys. reverseCashSettlement restores holds to 'held' but
    // never deletes the original escrow_release/payout/refund rows, so a
    // second settlement pass would otherwise hit ON CONFLICT DO NOTHING on
    // the same keys, insert nothing, credit nothing, and still mark the
    // holds released — silently destroying the escrowed money. Stamping
    // every key with a monotonically increasing generation (the count of
    // prior settlement-type rows for this event) keeps each settlement's
    // keys unique. The `status = 'held'` selection below is still the
    // primary guard against double-settling within the same generation (a
    // re-settle with no unresolve in between finds zero held holds and
    // returns the no_holds noop before writing anything) — this is
    // belt-and-braces for the unresolve/resolve cycle.
    const seqRow = await tx.sql`
      SELECT COUNT(*)::int AS n FROM transactions
      WHERE event_id = ${eventId} AND type IN ('escrow_release', 'payout', 'refund')
    `;
    const seq = seqRow.rows[0].n as number;

    const holdsResult = await tx.sql`
      SELECT * FROM escrow_holds WHERE event_id = ${eventId} AND status = 'held' ORDER BY user_id, id FOR UPDATE
    `;
    if (holdsResult.rows.length === 0) {
      return { mode: 'noop', reason: 'no_holds', pot: 0, payouts: [], refunds: [], holds_settled: 0 };
    }
    const holds = holdsResult.rows.map(mapEscrowHold);
    const potCents = holds.reduce((sum, h) => sum + toCents(h.amount), 0);

    // Join holds -> bets to know each hold's side / lateness.
    const joined = await tx.sql`
      SELECT h.*, b.side as bet_side, b.is_late as bet_is_late
      FROM escrow_holds h
      LEFT JOIN bets b ON b.id = h.bet_id
      WHERE h.event_id = ${eventId} AND h.status = 'held'
      ORDER BY h.user_id, h.id
    `;

    type JoinedHold = { id: string; user_id: string; amount: number; side: string | null; is_late: boolean | null };
    const joinedHolds: JoinedHold[] = joined.rows.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      amount: parseFloat(row.amount),
      side: row.bet_side ?? null,
      is_late: row.bet_is_late ?? null,
    }));

    // is_late !== true (rather than === false) so a legacy row with a NULL
    // is_late is treated as on-time instead of silently disqualifying a
    // winner.
    const winningHolds = winningSide === null
      ? []
      : joinedHolds.filter(h => h.side === winningSide && h.is_late !== true);

    const isRefundPath = winningSide === null || winningHolds.length === 0;

    if (isRefundPath) {
      const reason: 'cancelled' | 'no_winners' = winningSide === null ? 'cancelled' : 'no_winners';
      const refunds: SettlementRefund[] = [];

      // Ascending user_id (holds were selected ORDER BY user_id, id) to keep
      // wallet lock ordering deterministic and avoid deadlocks.
      for (const hold of holds) {
        const insertResult = await tx.sql`
          INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, event_id)
          VALUES (
            ${generateId()},
            ${hold.user_id},
            'refund',
            ${hold.amount},
            'completed',
            ${`Refund for "${event.title}"`},
            ${`refund:${eventId}:${hold.id}:${seq}`},
            ${eventId}
          )
          ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
          RETURNING *
        `;
        if (insertResult.rows.length > 0) {
          await creditWalletCents(tx, hold.user_id, toCents(hold.amount));
          refunds.push({ user_id: hold.user_id, amount: hold.amount });
        }
        await tx.sql`
          UPDATE escrow_holds SET status = 'refunded', released_at = CURRENT_TIMESTAMP
          WHERE id = ${hold.id} AND status = 'held'
        `;
      }

      return {
        mode: 'refund',
        reason,
        pot: fromCents(potCents),
        payouts: [],
        refunds,
        holds_settled: holds.length,
      };
    }

    // ---- payout path ----
    // Group winning stake by user.
    const winningCentsByUser = new Map<string, number>();
    for (const h of winningHolds) {
      winningCentsByUser.set(h.user_id, (winningCentsByUser.get(h.user_id) || 0) + toCents(h.amount));
    }
    const winningTotalCents = Array.from(winningCentsByUser.values()).reduce((a, b) => a + b, 0);

    // Deterministic pro-rata split with remainder-cent distribution: floor
    // each user's share, then hand out the leftover cents one at a time to
    // users ordered by (descending stake, ascending user_id) so the total
    // always sums to exactly potCents (invariant #2 must hold to the penny).
    const users = Array.from(winningCentsByUser.entries()).map(([user_id, stakeCents]) => ({
      user_id,
      stakeCents,
      grossCents: Math.floor((potCents * stakeCents) / winningTotalCents),
    }));

    let allocatedCents = users.reduce((sum, u) => sum + u.grossCents, 0);
    let remainderCents = potCents - allocatedCents;

    const remainderOrder = [...users].sort((a, b) => {
      if (b.stakeCents !== a.stakeCents) return b.stakeCents - a.stakeCents;
      return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
    });
    for (let i = 0; i < remainderOrder.length && remainderCents > 0; i++) {
      remainderOrder[i].grossCents += 1;
      remainderCents -= 1;
    }

    // Credit wallets in ascending user_id order to avoid deadlocks.
    users.sort((a, b) => (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0));

    const payouts: SettlementPayout[] = [];
    for (const u of users) {
      const stake = fromCents(u.stakeCents);
      const gross = fromCents(u.grossCents);
      const netWinnings = roundMoney(gross - stake);

      const releaseResult = await tx.sql`
        INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, event_id)
        VALUES (
          ${generateId()},
          ${u.user_id},
          'escrow_release',
          ${stake},
          'completed',
          ${`Stake returned — "${event.title}"`},
          ${`release:${eventId}:${u.user_id}:${seq}`},
          ${eventId}
        )
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
        RETURNING *
      `;
      if (releaseResult.rows.length > 0) {
        await creditWalletCents(tx, u.user_id, u.stakeCents);
      }

      if (netWinnings > 0) {
        const payoutCents = u.grossCents - u.stakeCents;
        const payoutResult = await tx.sql`
          INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, event_id)
          VALUES (
            ${generateId()},
            ${u.user_id},
            'payout',
            ${netWinnings},
            'completed',
            ${`Winnings — "${event.title}"`},
            ${`payout:${eventId}:${u.user_id}:${seq}`},
            ${eventId}
          )
          ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
          RETURNING *
        `;
        if (payoutResult.rows.length > 0) {
          await creditWalletCents(tx, u.user_id, payoutCents);
        }
      }

      payouts.push({ user_id: u.user_id, stake, gross, net_winnings: netWinnings });
    }

    // Mark ALL held holds released — winners and losers alike, since the
    // losers' stakes are what funded the pot.
    for (const hold of holds) {
      await tx.sql`
        UPDATE escrow_holds SET status = 'released', released_at = CURRENT_TIMESTAMP
        WHERE id = ${hold.id} AND status = 'held'
      `;
    }

    return {
      mode: 'payout',
      pot: fromCents(potCents),
      payouts,
      refunds: [],
      holds_settled: holds.length,
    };
  });
}

// ---- reversing a settlement (unresolve) --------------------------------

export interface ReverseCashSettlementResult {
  reversed_transactions: number;
  holds_restored: number;
  debited: Array<{ user_id: string; amount: number }>;
  already_reversed: boolean;
}

export async function reverseCashSettlement(eventId: string): Promise<ReverseCashSettlementResult> {
  return withTransaction(async (tx) => {
    const eventResult = await tx.sql`SELECT * FROM events WHERE id = ${eventId} FOR UPDATE`;
    if (eventResult.rows.length === 0) {
      throw new PaymentError('EVENT_NOT_FOUND', 'Event not found.', 404);
    }
    const event = eventResult.rows[0];

    if (event.payment_type !== 'cash') {
      return { reversed_transactions: 0, holds_restored: 0, debited: [], already_reversed: true };
    }

    const toReverseResult = await tx.sql`
      SELECT * FROM transactions t
      WHERE t.event_id = ${eventId}
        AND t.status = 'completed'
        AND t.type IN ('escrow_release', 'payout', 'refund')
        AND NOT EXISTS (
          SELECT 1 FROM transactions r WHERE r.idempotency_key = 'reverse:' || t.id
        )
      ORDER BY t.user_id
    `;

    if (toReverseResult.rows.length === 0) {
      return { reversed_transactions: 0, holds_restored: 0, debited: [], already_reversed: true };
    }

    const rowsToReverse = toReverseResult.rows.map(mapTransaction);

    // Aggregate the total debit per user first so we can pre-check every
    // balance before writing anything.
    const debitCentsByUser = new Map<string, number>();
    for (const row of rowsToReverse) {
      const cents = toCents(row.amount);
      debitCentsByUser.set(row.user_id, (debitCentsByUser.get(row.user_id) || 0) + cents);
    }

    const userIds = Array.from(debitCentsByUser.keys()).sort();
    const blocked: Array<{ user_id: string; balance: number; required: number }> = [];
    const balances = new Map<string, number>();
    for (const userId of userIds) {
      const walletResult = await tx.sql`SELECT user_id, balance FROM wallets WHERE user_id = ${userId} FOR UPDATE`;
      const balance = walletResult.rows.length > 0 ? parseFloat(walletResult.rows[0].balance) : 0;
      balances.set(userId, balance);
      const required = fromCents(debitCentsByUser.get(userId)!);
      if (balance < required) {
        blocked.push({ user_id: userId, balance, required });
      }
    }

    if (blocked.length > 0) {
      const blockedUserIds = blocked.map(b => b.user_id);
      const usersResult = await tx.sql`
        SELECT id, username FROM users WHERE id = ANY(${blockedUserIds as any}::text[])
      `;
      const usernameById = new Map<string, string>(usersResult.rows.map((r: any) => [r.id, r.username]));
      const blockedWithUsername = blocked.map(b => ({
        ...b,
        username: usernameById.get(b.user_id) || b.user_id,
      }));
      const first = blockedWithUsername[0];
      throw new PaymentError(
        'REVERSAL_BLOCKED',
        `Cannot unresolve: ${first.username} has already spent part of their payout.`,
        409,
        { blocked: blockedWithUsername }
      );
    }

    const debited: Array<{ user_id: string; amount: number }> = [];
    let reversedCount = 0;

    for (const row of rowsToReverse) {
      const insertResult = await tx.sql`
        INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, event_id)
        VALUES (
          ${generateId()},
          ${row.user_id},
          'escrow_hold',
          ${-row.amount},
          'completed',
          ${`Reversal of ${row.description || row.type}`},
          ${`reverse:${row.id}`},
          ${eventId}
        )
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
        RETURNING *
      `;
      if (insertResult.rows.length > 0) {
        await debitWalletGuarded(tx, row.user_id, row.amount, 'reversal');
        debited.push({ user_id: row.user_id, amount: row.amount });
        reversedCount += 1;
      }
    }

    const restoredResult = await tx.sql`
      UPDATE escrow_holds
      SET status = 'held', released_at = NULL
      WHERE event_id = ${eventId} AND status IN ('released', 'refunded')
      RETURNING id
    `;

    return {
      reversed_transactions: reversedCount,
      holds_restored: restoredResult.rows.length,
      debited,
      already_reversed: false,
    };
  });
}

// ---- Stripe deposits ---------------------------------------------------

export interface CreditStripeDepositResult {
  credited: boolean;
  duplicate: boolean;
  wallet: Wallet | null;
  transaction_id: string | null;
}

export async function creditStripeDeposit(params: {
  stripeEventId: string;
  paymentIntentId: string;
  userId: string;
  amount: number;
  description?: string;
}): Promise<CreditStripeDepositResult> {
  return withTransaction(async (tx) => {
    const key = `stripe:${params.stripeEventId}`;
    const amount = roundMoney(params.amount);

    // Path 1: settle the pending row created at intent-creation time.
    // - `idempotency_key = ${key}` unconditionally (not COALESCE-preserving
    //   whatever was already there): if the pending row already carried a
    //   key from elsewhere, COALESCE would silently drop the webhook's key,
    //   so a replay of THIS Stripe event would find no pending row (it's
    //   already completed) and no row under `stripe:<eventId>` either,
    //   falling through to Path 2 and crediting the wallet a second time.
    // - The subquery caps this to at most one row: if two stray pending
    //   rows ever existed for the same intent, updating both in one UPDATE
    //   would try to stamp both with the same idempotency_key and abort the
    //   whole transaction on the unique index.
    const settleResult = await tx.sql`
      UPDATE transactions
      SET status = 'completed', idempotency_key = ${key}
      WHERE id = (
        SELECT id FROM transactions
        WHERE stripe_payment_intent_id = ${params.paymentIntentId} AND status = 'pending' AND type = 'deposit'
        ORDER BY created_at ASC
        LIMIT 1
      )
      RETURNING *
    `;

    if (settleResult.rows.length > 0) {
      const txn = mapTransaction(settleResult.rows[0]);
      // Credit the pending row's own owner, not params.userId — the row
      // created at intent time is authoritative; Stripe metadata handed to
      // this call could in principle disagree and send money to the wrong
      // wallet.
      const wallet = await creditWalletCents(tx, txn.user_id, toCents(txn.amount));
      return { credited: true, duplicate: false, wallet, transaction_id: txn.id };
    }

    // Path 2: no pending row for this intent (already completed elsewhere,
    // or created out of band). Insert a fresh completed row, guarded two
    // ways: the idempotency key stops a replay of THIS Stripe event, and
    // the NOT EXISTS guard stops two *different* Stripe event ids for the
    // same payment intent (which would otherwise produce two distinct keys
    // and both credit) from crediting more than once.
    const insertResult = await tx.sql`
      INSERT INTO transactions (id, user_id, type, amount, status, stripe_payment_intent_id, description, idempotency_key)
      SELECT
        ${generateId()},
        ${params.userId},
        'deposit',
        ${amount},
        'completed',
        ${params.paymentIntentId},
        ${params.description || 'Deposit'},
        ${key}
      WHERE NOT EXISTS (
        SELECT 1 FROM transactions
        WHERE stripe_payment_intent_id = ${params.paymentIntentId} AND type = 'deposit' AND status = 'completed'
      )
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING *
    `;

    if (insertResult.rows.length > 0) {
      const txn = mapTransaction(insertResult.rows[0]);
      const wallet = await creditWalletCents(tx, txn.user_id, toCents(txn.amount));
      return { credited: true, duplicate: false, wallet, transaction_id: txn.id };
    }

    return { credited: false, duplicate: true, wallet: null, transaction_id: null };
  });
}

export async function failStripeDeposit(params: {
  stripeEventId: string;
  paymentIntentId: string;
}): Promise<{ updated: boolean }> {
  return withTransaction(async (tx) => {
    const result = await tx.sql`
      UPDATE transactions
      SET status = 'failed'
      WHERE stripe_payment_intent_id = ${params.paymentIntentId} AND status = 'pending'
      RETURNING id
    `;
    return { updated: result.rows.length > 0 };
  });
}

// ---- withdrawals -------------------------------------------------------

export interface WithdrawResult {
  wallet: Wallet;
  transaction: Transaction;
  duplicate: boolean;
}

export async function withdrawFromWallet(params: {
  userId: string;
  amount: number;
  idempotencyKey?: string;
  description?: string;
}): Promise<WithdrawResult> {
  return withTransaction(async (tx) => {
    const amount = roundMoney(params.amount);
    if (!(amount > 0)) {
      throw new PaymentError('INVALID_STAKE', 'Withdrawal amount must be greater than $0.', 400);
    }
    if (amount > MAX_TRANSACTION_AMOUNT) {
      throw new PaymentError('AMOUNT_TOO_LARGE', `Maximum transaction amount is $${MAX_TRANSACTION_AMOUNT}`, 400);
    }

    // Lock the wallet row before anything else so a concurrent request
    // (another withdrawal, a deposit, a settlement touching this user)
    // can't interleave with the idempotency check below.
    await tx.sql`
      INSERT INTO wallets (user_id, balance, currency)
      VALUES (${params.userId}, 0, 'usd')
      ON CONFLICT (user_id) DO NOTHING
    `;
    await tx.sql`SELECT balance FROM wallets WHERE user_id = ${params.userId} FOR UPDATE`;

    const key = params.idempotencyKey ? `withdraw:${params.userId}:${params.idempotencyKey}` : null;
    const description = params.description || `Withdrawal $${amount.toFixed(2)} — payout pending`;

    // Insert-first, not check-then-insert: a SELECT-then-INSERT race lets
    // two concurrent identical requests both pass the duplicate check, and
    // the loser then dies on the unique idempotency_key index instead of
    // returning the original result. Inserting first makes the unique index
    // itself the race arbiter — the loser's INSERT is simply a no-op.
    // This also fixes a correctness bug, not just a race: checking the
    // balance before the duplicate check would make a legitimate replay
    // fail with INSUFFICIENT_FUNDS once the original withdrawal has already
    // spent the money down.
    const insertResult = await tx.sql`
      INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key)
      VALUES (
        ${generateId()},
        ${params.userId},
        'withdrawal',
        ${-amount},
        'completed',
        ${description},
        ${key}
      )
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING *
    `;

    if (insertResult.rows.length === 0) {
      // A NULL idempotency_key never conflicts (the unique index is partial,
      // covering only non-NULL keys), so reaching here means params.idempotencyKey
      // was set and this is a genuine replay of an already-completed withdrawal.
      const existingResult = await tx.sql`SELECT * FROM transactions WHERE idempotency_key = ${key}`;
      const existingTxn = mapTransaction(existingResult.rows[0]);
      const walletResult = await tx.sql`SELECT * FROM wallets WHERE user_id = ${params.userId}`;
      const wallet = mapWallet(walletResult.rows[0]);
      return { wallet, transaction: existingTxn, duplicate: true };
    }

    const transaction = mapTransaction(insertResult.rows[0]);
    // Guarded debit after the insert: if this throws INSUFFICIENT_FUNDS, the
    // transaction rolls back and takes the just-inserted row with it — exactly
    // right, since the withdrawal never actually happened.
    const wallet = await debitWalletGuarded(tx, params.userId, amount, 'withdrawal');

    return { wallet, transaction, duplicate: false };
  });
}

// ---- read model for the UI --------------------------------------------

export interface EventWalletSummary {
  escrow_held: number;
  holds: EscrowHold[];
  transactions: Transaction[];
  pot: number;
  settled: boolean;
}

export interface WalletSummary {
  wallet: Wallet;
  escrow_held_total: number;
  available: number;
  event?: EventWalletSummary;
}

export async function getWalletSummary(userId: string, eventId?: string): Promise<WalletSummary> {
  const wallet = await db.wallets.getOrCreate(userId);
  const escrow_held_total = await db.escrowHolds.getHeldTotalForUser(userId);

  const summary: WalletSummary = {
    wallet,
    escrow_held_total,
    available: wallet.balance,
  };

  if (eventId) {
    const holdsResult = await sql`
      SELECT * FROM escrow_holds
      WHERE user_id = ${userId} AND event_id = ${eventId}
      ORDER BY created_at ASC
    `;
    const holds = holdsResult.rows.map(mapEscrowHold);
    const escrow_held = holds
      .filter(h => h.status === 'held')
      .reduce((sum, h) => sum + h.amount, 0);

    const transactionsResult = await sql`
      SELECT * FROM transactions
      WHERE user_id = ${userId} AND event_id = ${eventId} AND status = 'completed'
      ORDER BY created_at DESC
    `;
    const transactions = transactionsResult.rows.map(mapTransaction);

    const pot = await db.escrowHolds.getHeldTotalForEvent(eventId);
    // Event-wide, not scoped to this user: an event is only "settled" once
    // no held hold remains for ANY bettor. Since escrow_holds.amount has a
    // CHECK(amount > 0), pot === 0 iff there is no 'held' row left.
    const settled = pot === 0;

    summary.event = {
      escrow_held: roundMoney(escrow_held),
      holds,
      transactions,
      pot,
      settled,
    };
  }

  return summary;
}
