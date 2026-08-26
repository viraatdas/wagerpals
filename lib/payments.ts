import { sql, type VercelPoolClient } from '@vercel/postgres';
import { withTransaction, db } from './db';
import { generateId } from './utils';
import type { Wallet, Transaction, EscrowHold, Bet, Currency } from './types';

export const MAX_TRANSACTION_AMOUNT = 500;

export type PaymentErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'EVENT_NOT_FOUND'
  | 'EVENT_RESOLVED'
  | 'EVENT_NOT_RESOLVED'
  | 'INVALID_STAKE'
  | 'AMOUNT_TOO_LARGE'
  | 'REVERSAL_BLOCKED'
  | 'EXCEEDS_WITHDRAWABLE'
  | 'PAYOUT_FAILED';

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

// WagerPals is single-currency now: every bet/settlement/refund/cancel moves
// `wallets.balance` in usd, regardless of what an event's payment_type says.
// currencyForEvent() (which used to pick 'usd' vs the W's 'wp' off
// payment_type) is gone — there is nothing left to pick. payment_type stays
// as a column (existing rows, existing API shape) but no longer selects a
// ledger or gates anything in this file. `Currency`/'wp' remain on the types
// only because historical wp transactions/escrow_holds/wallet.wp_balance
// rows exist from before this consolidation and must keep reading back
// correctly — no code path in this file writes a new 'wp' row anymore.

// Renders an amount the way product copy wants it: "$25.00". Backend-only
// formatting for PaymentError messages and route-level text.
export function formatCurrencyAmount(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// ---- row mappers (mirrors lib/db.ts's private mapX helpers, since those
// aren't exported and this file must run its own tx.sql statements) --------

function mapWallet(row: any): Wallet {
  return {
    user_id: row.user_id,
    balance: parseFloat(row.balance),
    wp_balance: parseFloat(row.wp_balance),
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
    currency: (row.currency ?? 'usd') as Currency,
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
    currency: (row.currency ?? 'usd') as Currency,
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

// ---- Signup seed: everyone starts with $10 -------------------------------
//
// Lazy, idempotent, no-cron — same mechanism as every other money-moving
// insert in this file: a partial UNIQUE index on idempotency_key plus
// `ON CONFLICT (idempotency_key) DO NOTHING`, crediting the wallet only if a
// row was actually inserted. Two concurrent callers racing on the same key
// serialize on that unique index — Postgres blocks the loser's INSERT until
// the winner commits (or rolls back), so exactly one grant lands.
//
// LIABILITY NOTE: this $10 is house money, not a real deposit — nobody paid
// for it. It is fine today because withdrawals are ledger-only (no Stripe
// Connect payout or any other external transfer exists anywhere in this
// codebase — see withdrawFromWallet's own comment). The moment a real payout
// mechanism is wired up, withdrawable amount MUST exclude seed credits
// (i.e. subtract SUM of every `usd-seed:*` transaction from what a user is
// allowed to cash out), or a fleet of fake accounts mints real cash out of
// nothing. Do not let a future withdrawal implementation treat `balance` as
// 1:1 withdrawable without netting this out.

const SIGNUP_SEED_USD = 10;

function usdSeedKey(userId: string): string {
  return `usd-seed:${userId}`;
}

async function applyUsdSeedIfNeeded(tx: VercelPoolClient, userId: string): Promise<void> {
  const insertResult = await tx.sql`
    INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, currency)
    VALUES (${generateId()}, ${userId}, 'deposit', ${SIGNUP_SEED_USD}, 'completed', 'Signup credit', ${usdSeedKey(userId)}, 'usd')
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id
  `;
  if (insertResult.rows.length > 0) {
    await creditWalletCents(tx, userId, toCents(SIGNUP_SEED_USD));
  }
}

// Ensures the wallet row exists and the lazy signup seed has been applied,
// then returns the current wallet. This is "the wallet is ensured/read"
// choke point the spec calls out — GET/POST /api/wallet and
// getWalletSummary all funnel through this rather than lib/db.ts's plain
// db.wallets.getOrCreate, because writing ledger transactions belongs in
// the money engine (see this file's file-ownership note), not a dumb
// accessor.
export async function ensureWallet(userId: string): Promise<Wallet> {
  return withTransaction(async (tx) => {
    await tx.sql`
      INSERT INTO wallets (user_id, balance, wp_balance, currency)
      VALUES (${userId}, 0, 0, 'usd')
      ON CONFLICT (user_id) DO NOTHING
    `;
    await applyUsdSeedIfNeeded(tx, userId);
    const result = await tx.sql`SELECT * FROM wallets WHERE user_id = ${userId}`;
    return mapWallet(result.rows[0]);
  });
}

// Ensures a wallet row exists, then locks it FOR UPDATE and returns the usd
// balance. Callers must be inside a withTransaction. This is also a "wallet
// touch" — it applies the same lazy signup-seed mechanics as ensureWallet()
// before reading the balance, so a brand-new user placing their very first
// bet (with no prior GET /api/wallet call) still has their $10 seed
// available to stake.
async function lockOrCreateWallet(tx: VercelPoolClient, userId: string): Promise<number> {
  await tx.sql`
    INSERT INTO wallets (user_id, balance, wp_balance, currency)
    VALUES (${userId}, 0, 0, 'usd')
    ON CONFLICT (user_id) DO NOTHING
  `;
  await applyUsdSeedIfNeeded(tx, userId);
  const result = await tx.sql`SELECT balance FROM wallets WHERE user_id = ${userId} FOR UPDATE`;
  return parseFloat(result.rows[0].balance);
}

// Guarded credit: creates the wallet row if missing, then adds `amountCents`
// to `balance`. Callers are expected to have already established a
// deterministic lock order (ascending user_id) across the whole settlement
// to avoid deadlocks.
async function creditWalletCents(tx: VercelPoolClient, userId: string, amountCents: number): Promise<Wallet> {
  const amount = fromCents(amountCents);
  await tx.sql`
    INSERT INTO wallets (user_id, balance, wp_balance, currency)
    VALUES (${userId}, 0, 0, 'usd')
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
// CHECK constraint) when the balance would go negative. Its own guarded
// UPDATE on `balance` is the invariant this whole engine relies on (see
// CLAUDE.md §8 Money idempotency): a concurrent debit that wins the race
// makes the loser's UPDATE affect zero rows here.
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
    const message = `Insufficient balance. You have ${formatCurrencyAmount(balance)} but ${DEBIT_CONTEXT_LABEL[context]} needs ${formatCurrencyAmount(amount)}.`;
    throw new PaymentError(
      'INSUFFICIENT_FUNDS',
      message,
      400,
      { balance, required: amount, shortfall: roundMoney(amount - balance), currency: 'usd' }
    );
  }
  return mapWallet(result.rows[0]);
}

// ---- placing a bet (cash events stake usd, play events stake the W) ----

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

// Named placeCashBet for backward compatibility with every existing call
// site (app/api/bets, both iMessage bet routes) — it stakes usd through the
// escrow engine (guarded debit, escrow_holds row, escrow_hold transaction,
// bet.escrow_hold_id) for EVERY event now, regardless of payment_type. There
// is only one ledger; payment_type no longer selects one.
export async function placeCashBet(input: PlaceCashBetInput): Promise<PlaceCashBetResult> {
  return withTransaction(async (tx) => {
    const eventResult = await tx.sql`SELECT * FROM events WHERE id = ${input.eventId} FOR UPDATE`;
    if (eventResult.rows.length === 0) {
      throw new PaymentError('EVENT_NOT_FOUND', 'Event not found.', 404);
    }
    const event = eventResult.rows[0];
    const currency: Currency = 'usd';

    if (event.status !== 'active') {
      throw new PaymentError('EVENT_RESOLVED', 'This event has already been resolved.', 400);
    }
    // R1: events are live until the creator resolves them, never by time —
    // no end_time gate here. (Previously rejected a bet once
    // Date.now() > event.end_time as EVENT_CLOSED; status is now the only
    // gate, for both currencies.)

    const fixedStake = event.stake_amount !== null && event.stake_amount !== undefined
      ? parseFloat(event.stake_amount)
      : null;

    let stake: number;
    if (fixedStake !== null && fixedStake > 0) {
      if (roundMoney(input.amount) !== roundMoney(fixedStake)) {
        throw new PaymentError(
          'INVALID_STAKE',
          `This event has a fixed stake of ${formatCurrencyAmount(fixedStake)}.`,
          400,
          { required_stake: fixedStake }
        );
      }
      stake = roundMoney(fixedStake);
    } else {
      stake = roundMoney(input.amount);
      if (!(stake > 0)) {
        throw new PaymentError('INVALID_STAKE', `Stake must be greater than ${formatCurrencyAmount(0)}.`, 400);
      }
      if (stake > MAX_TRANSACTION_AMOUNT) {
        throw new PaymentError(
          'AMOUNT_TOO_LARGE',
          `Maximum transaction amount is ${formatCurrencyAmount(MAX_TRANSACTION_AMOUNT)}`,
          400
        );
      }
    }

    const currentBalance = await lockOrCreateWallet(tx, input.userId);
    if (currentBalance < stake) {
      // Nothing has been written yet — throwing here rolls the whole
      // transaction back, which is the point (no partial holds/debits).
      const message = `Insufficient balance. You have ${formatCurrencyAmount(currentBalance)} but this bet needs ${formatCurrencyAmount(stake)}.`;
      throw new PaymentError(
        'INSUFFICIENT_FUNDS',
        message,
        400,
        { balance: currentBalance, required: stake, shortfall: roundMoney(stake - currentBalance), currency }
      );
    }

    // Guarded UPDATE is the race-loser path: another concurrent debit could
    // have won between the balance read above and this statement.
    const wallet = await debitWalletGuarded(tx, input.userId, stake, 'bet');

    const holdId = generateId();
    const holdResult = await tx.sql`
      INSERT INTO escrow_holds (id, event_id, bet_id, user_id, amount, status, currency)
      VALUES (${holdId}, ${input.eventId}, NULL, ${input.userId}, ${stake}, 'held', ${currency})
      RETURNING *
    `;
    const hold = mapEscrowHold(holdResult.rows[0]);

    const transactionId = generateId();
    const txnResult = await tx.sql`
      INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, event_id, currency)
      VALUES (
        ${transactionId},
        ${input.userId},
        'escrow_hold',
        ${-stake},
        'completed',
        ${`Stake on "${input.side}": ${event.title}`},
        ${`bet:${holdId}`},
        ${input.eventId},
        ${currency}
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
  currency: Currency;
}

// Named settleCashEvent for backward compatibility — settles usd for EVERY
// event now, regardless of payment_type. Only ever moves money for bets
// that actually HAVE an escrow hold: a legacy hold-less bet (escrow_hold_id
// NULL — either pre-dating escrow entirely, or a play bet placed before this
// consolidation) has no escrow_holds row at all, so it is structurally
// excluded from every query below — it settles as pure bookkeeping
// (net_total/streak, done by the resolve route, not here) and never touches
// a wallet.
export async function settleCashEvent(eventId: string, winningSide: string | null): Promise<SettleCashEventResult> {
  return withTransaction(async (tx) => {
    const eventResult = await tx.sql`SELECT * FROM events WHERE id = ${eventId} FOR UPDATE`;
    if (eventResult.rows.length === 0) {
      throw new PaymentError('EVENT_NOT_FOUND', 'Event not found.', 404);
    }
    const event = eventResult.rows[0];
    const currency: Currency = 'usd';

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
      return { mode: 'noop', reason: 'no_holds', pot: 0, payouts: [], refunds: [], holds_settled: 0, currency };
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
          INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, event_id, currency)
          VALUES (
            ${generateId()},
            ${hold.user_id},
            'refund',
            ${hold.amount},
            'completed',
            ${`Refund for "${event.title}"`},
            ${`refund:${eventId}:${hold.id}:${seq}`},
            ${eventId},
            ${currency}
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
        currency,
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
        INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, event_id, currency)
        VALUES (
          ${generateId()},
          ${u.user_id},
          'escrow_release',
          ${stake},
          'completed',
          ${`Stake returned: "${event.title}"`},
          ${`release:${eventId}:${u.user_id}:${seq}`},
          ${eventId},
          ${currency}
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
          INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, event_id, currency)
          VALUES (
            ${generateId()},
            ${u.user_id},
            'payout',
            ${netWinnings},
            'completed',
            ${`Winnings: "${event.title}"`},
            ${`payout:${eventId}:${u.user_id}:${seq}`},
            ${eventId},
            ${currency}
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
      currency,
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

// Named reverseCashSettlement for backward compatibility — reverses usd for
// EVERY event now, regardless of payment_type. Same "structurally a noop
// for anything that was never settled" property as settleCashEvent: an
// event with no escrow_release/payout/refund rows (either because it never
// had any bets, or every bet was a hold-less legacy bet) simply finds zero
// rows to reverse below and returns already_reversed: false with
// reversed_transactions: 0 — no special-case branch needed.
export async function reverseCashSettlement(eventId: string): Promise<ReverseCashSettlementResult> {
  return withTransaction(async (tx) => {
    const eventResult = await tx.sql`SELECT * FROM events WHERE id = ${eventId} FOR UPDATE`;
    if (eventResult.rows.length === 0) {
      throw new PaymentError('EVENT_NOT_FOUND', 'Event not found.', 404);
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
        INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, event_id, currency)
        VALUES (
          ${generateId()},
          ${row.user_id},
          'escrow_hold',
          ${-row.amount},
          'completed',
          ${`Reversal of ${row.description || row.type}`},
          ${`reverse:${row.id}`},
          ${eventId},
          'usd'
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

// ---- Stripe deposits (usd only — no Stripe path exists for the W) ------

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
      INSERT INTO transactions (id, user_id, type, amount, status, stripe_payment_intent_id, description, idempotency_key, currency)
      SELECT
        ${generateId()},
        ${params.userId},
        'deposit',
        ${amount},
        'completed',
        ${params.paymentIntentId},
        ${params.description || 'Deposit'},
        ${key},
        'usd'
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

// ---- withdrawals (usd only — the W is never withdrawable) --------------

// ---- withdrawals: refund to source -------------------------------------
//
// Money leaves this platform the same way it came in: as a Stripe REFUND
// against the user's own deposit PaymentIntents. That choice is what makes
// withdrawals safe to ship at all.
//
//   - No Stripe Connect, no connected accounts, no KYC onboarding. Refunds
//     work with the plain secret key that already credits deposits.
//   - It cannot mint money. A refund can only send dollars back to a card
//     that previously sent them here, so the `usd-seed:*` house grants and
//     any winnings taken off other players are structurally unwithdrawable.
//     That is the netting the LIABILITY NOTE on grantSignupBonus demands,
//     enforced by Stripe itself rather than by arithmetic we could get wrong.
//
// The limit that buys: a user can never cash out more than they put in.
// Winnings above your own deposits stay in the wallet as spending money.
// Paying those out is money transmission and needs Connect plus licensing,
// which is a product decision, not a missing function.
//
// WITHDRAWABLE = min(balance, lifetime completed deposits - everything already
// withdrawn). Both halves matter: the balance half stops you withdrawing money
// you have already lost, the deposits half stops you withdrawing money you
// never paid in.
export interface WithdrawableBreakdown {
  withdrawable: number;
  balance: number;
  deposited: number;
  withdrawn: number;
}

// Runs against a caller-supplied client so it can be computed INSIDE the same
// transaction that holds the wallet lock. Two concurrent withdrawals must not
// both see the full headroom and both pass.
type SqlRunner = {
  sql: (strings: TemplateStringsArray, ...values: any[]) => Promise<{ rows: any[] }>;
};

async function readWithdrawable(
  tx: SqlRunner,
  userId: string
): Promise<WithdrawableBreakdown> {
  const walletRow = await tx.sql`SELECT balance FROM wallets WHERE user_id = ${userId}`;
  const balance = roundMoney(Number(walletRow.rows[0]?.balance ?? 0));

  // Only 'completed' deposits count: a pending PaymentIntent has not settled,
  // and a failed one never will.
  //
  // `stripe_payment_intent_id IS NOT NULL` is the load-bearing clause, not a
  // tidiness one. applyUsdSeedIfNeeded writes the $10 signup grant as a
  // type='deposit' row (idempotency_key 'usd-seed:<userId>') with no payment
  // intent, because nobody paid for it. Summing bare type='deposit' would make
  // that house money withdrawable and let a fleet of fake accounts mint real
  // cash — precisely the failure grantSignupBonus's LIABILITY NOTE predicts.
  // Requiring a payment intent also generalises: any future credit that did
  // not arrive from a card is unwithdrawable by construction, and it lines up
  // with the payout mechanism, which can only refund intents that exist.
  const depositRow = await tx.sql`
    SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
    WHERE user_id = ${userId} AND type = 'deposit' AND status = 'completed' AND currency = 'usd'
      AND stripe_payment_intent_id IS NOT NULL
  `;
  const deposited = roundMoney(Number(depositRow.rows[0]?.total ?? 0));

  // 'pending' counts as spent headroom, not just 'completed'. A withdrawal
  // whose refunds are still in flight has already claimed those dollars; if
  // it later fails, failWithdrawalPayout puts the headroom back by marking
  // the row 'failed'.
  const withdrawnRow = await tx.sql`
    SELECT COALESCE(SUM(ABS(amount)), 0) AS total FROM transactions
    WHERE user_id = ${userId} AND type = 'withdrawal'
      AND status IN ('pending', 'completed') AND currency = 'usd'
  `;
  const withdrawn = roundMoney(Number(withdrawnRow.rows[0]?.total ?? 0));

  const headroom = roundMoney(deposited - withdrawn);
  return {
    withdrawable: Math.max(0, roundMoney(Math.min(balance, headroom))),
    balance,
    deposited,
    withdrawn,
  };
}

export async function getWithdrawable(userId: string): Promise<WithdrawableBreakdown> {
  await ensureWallet(userId);
  return readWithdrawable({ sql }, userId);
}

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
      INSERT INTO wallets (user_id, balance, wp_balance, currency)
      VALUES (${params.userId}, 0, 0, 'usd')
      ON CONFLICT (user_id) DO NOTHING
    `;
    await tx.sql`SELECT balance FROM wallets WHERE user_id = ${params.userId} FOR UPDATE`;

    const key = params.idempotencyKey ? `withdraw:${params.userId}:${params.idempotencyKey}` : null;
    const description = params.description || `Withdrawal $${amount.toFixed(2)}: payout pending`;

    // Insert-first, not check-then-insert: a SELECT-then-INSERT race lets
    // two concurrent identical requests both pass the duplicate check, and
    // the loser then dies on the unique idempotency_key index instead of
    // returning the original result. Inserting first makes the unique index
    // itself the race arbiter — the loser's INSERT is simply a no-op.
    // This also fixes a correctness bug, not just a race: checking the
    // balance before the duplicate check would make a legitimate replay
    // fail with INSUFFICIENT_FUNDS once the original withdrawal has already
    // spent the money down.
    // Cap the withdrawal at what this user actually paid in and has not
    // already taken out. Computed under the wallet lock taken above, so two
    // concurrent withdrawals can't both see the same headroom — the second
    // one reads the first's 'pending' row and is refused.
    const headroom = await readWithdrawable(tx, params.userId);
    if (amount > headroom.withdrawable) {
      throw new PaymentError(
        'EXCEEDS_WITHDRAWABLE',
        headroom.withdrawable > 0
          ? `You can withdraw up to $${headroom.withdrawable.toFixed(2)}. Money goes back to the card it came from, so winnings above what you deposited stay in your wallet.`
          : 'You have nothing to withdraw yet. Money goes back to the card it came from, so only deposits can be withdrawn.',
        400,
        headroom as unknown as Record<string, unknown>
      );
    }

    // Status is 'pending', not 'completed': the wallet debit below is real
    // and immediate, but the Stripe refunds have not been created yet.
    // completeWithdrawalPayout / failWithdrawalPayout move this row once the
    // money has actually moved, so the ledger never claims a payout that has
    // not happened. The debit lands first on purpose — a crash between here
    // and the refund leaves the user short but recoverable, whereas
    // refunding first and crashing would pay out money we never debited.
    const insertResult = await tx.sql`
      INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, currency)
      VALUES (
        ${generateId()},
        ${params.userId},
        'withdrawal',
        ${-amount},
        'pending',
        ${description},
        ${key},
        'usd'
      )
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING *
    `;

    if (insertResult.rows.length === 0) {
      // A NULL idempotency_key never conflicts (the unique index is partial,
      // covering only non-NULL keys), so reaching here means params.idempotencyKey
      // was set and this is a genuine replay of an already-submitted (pending)
      // withdrawal.
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

// The Stripe surface this module needs, and nothing more. Injected rather
// than imported so the money engine stays testable without a network or an
// SDK — same reason lib/push.ts takes a PushTransport.
export interface RefundGateway {
  // Cents still refundable on this PaymentIntent (captured minus refunded).
  refundableCents(paymentIntentId: string): Promise<number>;
  // MUST be idempotent on idempotencyKey: a retry returns the original refund
  // rather than sending the money twice.
  createRefund(args: {
    paymentIntentId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
}

export interface PayoutResult {
  transaction: Transaction;
  refundIds: string[];
  paidOut: number;
  returnedToWallet: number;
}

/**
 * Turn a pending withdrawal row into actual Stripe refunds against the user's
 * own deposits, then finalize the ledger.
 *
 * Deliberately NOT inside withTransaction: it makes network calls, and holding
 * a Postgres transaction open across a Stripe round trip would pin a pool
 * connection for the duration and widen every lock it holds.
 *
 * Newest deposit first. Older PaymentIntents are likelier to be past a card
 * network's refund window, so spending the fresh ones first fails less often.
 */
export async function executeWithdrawalPayout(params: {
  userId: string;
  transactionId: string;
  amount: number;
  gateway: RefundGateway;
}): Promise<PayoutResult> {
  const wantCents = Math.round(roundMoney(params.amount) * 100);

  const depositRows = await sql`
    SELECT stripe_payment_intent_id, created_at
    FROM transactions
    WHERE user_id = ${params.userId}
      AND type = 'deposit'
      AND status = 'completed'
      AND currency = 'usd'
      AND stripe_payment_intent_id IS NOT NULL
    ORDER BY created_at DESC
  `;

  // Pass one: plan. Ask Stripe what is actually refundable on each intent and
  // build the whole allocation BEFORE moving a cent. If the plan cannot cover
  // the request we abort having created zero refunds, which is much easier to
  // reason about than unwinding half a payout.
  const plan: Array<{ paymentIntentId: string; amountCents: number }> = [];
  let unplanned = wantCents;
  for (const row of depositRows.rows) {
    if (unplanned <= 0) break;
    const pi = String(row.stripe_payment_intent_id);
    let available = 0;
    try {
      available = await params.gateway.refundableCents(pi);
    } catch (err) {
      // A single unreadable intent must not sink the payout; skip it and
      // keep planning against the rest.
      console.error(`[payout] could not read refundable amount for ${pi}`, err);
      continue;
    }
    const take = Math.min(unplanned, available);
    if (take > 0) {
      plan.push({ paymentIntentId: pi, amountCents: take });
      unplanned -= take;
    }
  }

  if (unplanned > 0) {
    await failWithdrawalPayout({
      userId: params.userId,
      transactionId: params.transactionId,
      amount: params.amount,
      reason: 'no refundable deposit covers this amount',
    });
    throw new PaymentError(
      'PAYOUT_FAILED',
      'We could not send this back to your card. Your money has been returned to your wallet balance.',
      502
    );
  }

  // Pass two: execute. The idempotency key is derived from the withdrawal row
  // id and the intent, so replaying this whole function (a retry, a crash
  // between refunds, a duplicate request) re-requests the SAME refund from
  // Stripe and gets the original back instead of paying twice.
  const refundIds: string[] = [];
  let paidCents = 0;
  for (const step of plan) {
    try {
      const refund = await params.gateway.createRefund({
        paymentIntentId: step.paymentIntentId,
        amountCents: step.amountCents,
        idempotencyKey: `wd:${params.transactionId}:${step.paymentIntentId}`,
      });
      refundIds.push(refund.id);
      paidCents += step.amountCents;
    } catch (err) {
      console.error(`[payout] refund failed on ${step.paymentIntentId}`, err);
      break;
    }
  }

  const paidOut = roundMoney(paidCents / 100);
  const shortfall = roundMoney(params.amount - paidOut);

  if (paidOut === 0) {
    await failWithdrawalPayout({
      userId: params.userId,
      transactionId: params.transactionId,
      amount: params.amount,
      reason: 'every refund attempt was rejected',
    });
    throw new PaymentError(
      'PAYOUT_FAILED',
      'We could not send this back to your card. Your money has been returned to your wallet balance.',
      502
    );
  }

  // Partial success: some refunds landed, some did not. Pay out what moved,
  // hand the rest straight back, and correct the ledger row down to the truth
  // rather than leaving it claiming an amount that never left.
  const transaction = await withTransaction(async (tx) => {
    if (shortfall > 0) {
      await tx.sql`SELECT balance FROM wallets WHERE user_id = ${params.userId} FOR UPDATE`;
      await tx.sql`UPDATE wallets SET balance = balance + ${shortfall} WHERE user_id = ${params.userId}`;
    }
    const updated = await tx.sql`
      UPDATE transactions
      SET status = 'completed',
          amount = ${-paidOut},
          description = ${`Withdrawal $${paidOut.toFixed(2)} refunded to card (${refundIds.join(', ')})`}
      WHERE id = ${params.transactionId} AND status = 'pending'
      RETURNING *
    `;
    if (updated.rows.length === 0) {
      // Already finalized by a concurrent runner; read it back rather than
      // double-crediting anything.
      const existing = await tx.sql`SELECT * FROM transactions WHERE id = ${params.transactionId}`;
      return mapTransaction(existing.rows[0]);
    }
    return mapTransaction(updated.rows[0]);
  });

  return { transaction, refundIds, paidOut, returnedToWallet: shortfall };
}

/**
 * Undo a withdrawal whose payout never happened: put the money back in the
 * wallet and mark the row 'failed' so readWithdrawable stops counting it as
 * spent headroom. Guarded on status='pending' so it cannot double-credit.
 */
export async function failWithdrawalPayout(params: {
  userId: string;
  transactionId: string;
  amount: number;
  reason: string;
}): Promise<void> {
  await withTransaction(async (tx) => {
    const updated = await tx.sql`
      UPDATE transactions
      SET status = 'failed',
          description = ${`Withdrawal $${roundMoney(params.amount).toFixed(2)} failed: ${params.reason}`}
      WHERE id = ${params.transactionId} AND status = 'pending'
      RETURNING id
    `;
    if (updated.rows.length === 0) return;
    await tx.sql`SELECT balance FROM wallets WHERE user_id = ${params.userId} FOR UPDATE`;
    await tx.sql`UPDATE wallets SET balance = balance + ${roundMoney(params.amount)} WHERE user_id = ${params.userId}`;
  });
}

// ---- read model for the UI --------------------------------------------

export interface EventWalletSummary {
  currency: Currency;
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
  // W counterparts of escrow_held_total/available — additive, never mixed
  // with the usd figures above.
  escrow_held_total_wp: number;
  available_wp: number;
  event?: EventWalletSummary;
}

export async function getWalletSummary(userId: string, eventId?: string): Promise<WalletSummary> {
  const wallet = await ensureWallet(userId);
  const escrow_held_total = await db.escrowHolds.getHeldTotalForUser(userId, 'usd');
  const escrow_held_total_wp = await db.escrowHolds.getHeldTotalForUser(userId, 'wp');

  const summary: WalletSummary = {
    wallet,
    escrow_held_total,
    available: wallet.balance,
    escrow_held_total_wp,
    available_wp: wallet.wp_balance,
  };

  if (eventId) {
    // Every event's holds/transactions are usd now — payment_type no longer
    // selects a ledger, so there is nothing left to look up on the event row.
    const currency: Currency = 'usd';

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
      currency,
      escrow_held: roundMoney(escrow_held),
      holds,
      transactions,
      pot,
      settled,
    };
  }

  return summary;
}
