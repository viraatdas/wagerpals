// Verifies that the "comeback" migration (scripts/migrate-comeback.ts) landed completely.
//
// Two layers of checks:
//   1. Structural — every column, table, index and constraint the migration creates exists,
//      with the right uniqueness / validation state.
//   2. Functional — the new constraints and foreign keys actually behave, exercised inside a
//      transaction that is ALWAYS rolled back, so this script never mutates the database.
//
// Read-only. Exits 1 if anything is missing so it can gate a deploy.
import { sql, createClient } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });

type Check = { label: string; ok: boolean; detail?: string };

const results: Check[] = [];

function record(label: string, ok: boolean, detail?: string): void {
  results.push({ label, ok, detail });
  const icon = ok ? '✅' : '❌';
  console.log(`  ${icon} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function checkColumn(table: string, column: string, opts: { notNull?: boolean; hasDefault?: boolean } = {}): Promise<void> {
  const res = await sql`
    SELECT data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `;
  if (res.rows.length === 0) {
    record(`${table}.${column}`, false, 'column missing');
    return;
  }
  const row = res.rows[0];
  const problems: string[] = [];
  if (opts.notNull && row.is_nullable !== 'NO') problems.push('expected NOT NULL');
  if (opts.hasDefault && row.column_default === null) problems.push('expected a DEFAULT');
  record(`${table}.${column}`, problems.length === 0, problems.length ? problems.join('; ') : String(row.data_type));
}

async function checkTable(table: string, expectedColumns: string[]): Promise<void> {
  const res = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  if (res.rows.length === 0) {
    record(`table ${table}`, false, 'table missing');
    return;
  }
  const present = new Set(res.rows.map((r) => r.column_name as string));
  const missing = expectedColumns.filter((c) => !present.has(c));
  record(`table ${table}`, missing.length === 0, missing.length ? `missing columns: ${missing.join(', ')}` : `${present.size} columns`);
}

async function checkIndex(indexName: string, opts: { unique?: boolean } = {}): Promise<void> {
  const res = await sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${indexName}`;
  if (res.rows.length === 0) {
    record(`index ${indexName}`, false, 'index missing');
    return;
  }
  const def = res.rows[0].indexdef as string;
  if (opts.unique && !/CREATE UNIQUE INDEX/i.test(def)) {
    record(`index ${indexName}`, false, 'exists but is not UNIQUE');
    return;
  }
  record(`index ${indexName}`, true, opts.unique ? 'unique' : 'present');
}

async function checkConstraint(table: string, constraintName: string, opts: { mustValidate?: boolean } = {}): Promise<void> {
  const res = await sql`
    SELECT convalidated FROM pg_constraint
    WHERE conname = ${constraintName} AND conrelid = ${`public.${table}`}::regclass
  `;
  if (res.rows.length === 0) {
    record(`constraint ${table}.${constraintName}`, false, 'constraint missing');
    return;
  }
  const validated = res.rows[0].convalidated === true;
  if (opts.mustValidate && !validated) {
    record(`constraint ${table}.${constraintName}`, false, 'present but NOT VALID (existing rows unchecked)');
    return;
  }
  record(`constraint ${table}.${constraintName}`, true, validated ? 'validated' : 'present (NOT VALID)');
}

async function structuralChecks(): Promise<void> {
  console.log('1. users: identity & auth columns');
  await checkColumn('users', 'email');
  await checkColumn('users', 'display_name');
  await checkColumn('users', 'avatar_url');
  await checkColumn('users', 'auth_methods', { notNull: true, hasDefault: true });
  await checkColumn('users', 'merged_into');
  await checkColumn('users', 'last_seen_at');

  console.log('\n2. users: indexes');
  await checkIndex('idx_users_email_lower', { unique: true });
  await checkIndex('idx_users_merged_into');
  await checkIndex('idx_users_last_seen_at');

  console.log('\n3. events: payment & subject-privacy columns');
  await checkColumn('events', 'payment_type', { notNull: true, hasDefault: true });
  await checkColumn('events', 'stake_amount');
  await checkColumn('events', 'subject_user_id');
  await checkColumn('events', 'notify_subject', { notNull: true, hasDefault: true });

  console.log('\n4. events: constraint & indexes');
  await checkConstraint('events', 'events_payment_type_check');
  await checkIndex('idx_events_payment_type');
  await checkIndex('idx_events_subject_user_id');

  console.log('\n5. escrow_holds table & constraints');
  await checkTable('escrow_holds', ['id', 'event_id', 'bet_id', 'user_id', 'amount', 'status', 'created_at', 'released_at']);
  await checkConstraint('escrow_holds', 'escrow_holds_amount_check');
  await checkConstraint('escrow_holds', 'escrow_holds_status_check');

  console.log('\n6. escrow_holds: indexes');
  await checkIndex('idx_escrow_holds_bet_id', { unique: true });
  await checkIndex('idx_escrow_holds_event_id');
  await checkIndex('idx_escrow_holds_user_id');
  await checkIndex('idx_escrow_holds_status');

  console.log('\n7. bets: escrow link');
  await checkColumn('bets', 'escrow_hold_id');
  await checkIndex('idx_bets_escrow_hold_id');

  console.log('\n8. transactions: columns, constraint & indexes');
  await checkColumn('transactions', 'idempotency_key');
  await checkColumn('transactions', 'event_id');
  await checkConstraint('transactions', 'transactions_type_check', { mustValidate: true });
  await checkIndex('idx_transactions_idempotency_key', { unique: true });
  await checkIndex('idx_transactions_event_id');

  console.log('\n9. notification tables & indexes');
  await checkTable('notification_preferences', ['user_id', 'push_enabled', 'email_enabled', 'categories', 'updated_at']);
  await checkTable('event_notification_mutes', ['id', 'event_id', 'user_id', 'reason', 'created_at']);
  await checkIndex('idx_event_notification_mutes_event_id');
  await checkIndex('idx_event_notification_mutes_user_id');

  console.log('\n10. comments: threading columns & indexes');
  await checkColumn('comments', 'parent_id');
  await checkColumn('comments', 'edited_at');
  await checkColumn('comments', 'deleted_at');
  await checkIndex('idx_comments_parent_id');
  await checkIndex('idx_comments_event_timestamp');

  console.log('\n11. comment_reactions & comment_mentions');
  await checkTable('comment_reactions', ['id', 'comment_id', 'user_id', 'emoji', 'created_at']);
  await checkIndex('idx_comment_reactions_comment_id');
  await checkIndex('idx_comment_reactions_user_id');
  await checkTable('comment_mentions', ['id', 'comment_id', 'mentioned_user_id', 'created_at']);
  await checkIndex('idx_comment_mentions_comment_id');
  await checkIndex('idx_comment_mentions_mentioned_user_id');

  console.log('\n12. groups: cash_enabled column');
  await checkColumn('groups', 'cash_enabled', { notNull: true, hasDefault: true });

  console.log('\n13. events: created_by column & index (R2 — resolver is the event creator)');
  await checkColumn('events', 'created_by');
  await checkIndex('idx_events_created_by');

  console.log('\n14. The W: wallets/transactions/escrow_holds currency columns');
  await checkColumn('wallets', 'wp_balance', { notNull: true, hasDefault: true });
  await checkConstraint('wallets', 'wallets_wp_balance_check');
  await checkColumn('transactions', 'currency', { notNull: true, hasDefault: true });
  await checkConstraint('transactions', 'transactions_currency_check');
  await checkColumn('escrow_holds', 'currency', { notNull: true, hasDefault: true });
  await checkConstraint('escrow_holds', 'escrow_holds_currency_check');
}

async function dataChecks(): Promise<void> {
  console.log('\n15. data integrity');

  const orphans = await sql`
    SELECT COUNT(*)::int AS c FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM notification_preferences p WHERE p.user_id = u.id)
  `;
  record('every user has notification_preferences', orphans.rows[0].c === 0, `${orphans.rows[0].c} user(s) without a row`);

  const dupes = await sql`
    SELECT LOWER(email) AS e, COUNT(*)::int AS c FROM users
    WHERE email IS NOT NULL GROUP BY LOWER(email) HAVING COUNT(*) > 1
  `;
  record('no duplicate case-insensitive emails', dupes.rows.length === 0, dupes.rows.length ? dupes.rows.map((r) => `${r.e} x${r.c}`).join(', ') : 'none');

  const badPaymentType = await sql`SELECT COUNT(*)::int AS c FROM events WHERE payment_type NOT IN ('none', 'cash')`;
  record('all events.payment_type within allowed set', badPaymentType.rows[0].c === 0, `${badPaymentType.rows[0].c} offending row(s)`);

  const badTxType = await sql`
    SELECT COUNT(*)::int AS c FROM transactions
    WHERE type NOT IN ('deposit', 'withdrawal', 'bet_placed', 'bet_refund', 'winnings', 'escrow_hold', 'escrow_release', 'payout', 'refund')
  `;
  record('all transactions.type within allowed set', badTxType.rows[0].c === 0, `${badTxType.rows[0].c} offending row(s)`);

  const danglingMerge = await sql`
    SELECT COUNT(*)::int AS c FROM users u
    WHERE u.merged_into IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users t WHERE t.id = u.merged_into)
  `;
  record('users.merged_into points at a real user', danglingMerge.rows[0].c === 0, `${danglingMerge.rows[0].c} dangling pointer(s)`);

  // R2: every event should have a resolver the moment this migration lands —
  // either its own created_by or (pre-backfill safety net) its group's.
  // groups.created_by is NOT NULL and events.group_id cascades on group
  // delete, so a NULL here after the backfill step means the backfill
  // itself didn't run, not a legitimately orphaned event.
  const missingCreatedBy = await sql`SELECT COUNT(*)::int AS c FROM events WHERE created_by IS NULL`;
  record('every event has created_by (post-backfill)', missingCreatedBy.rows[0].c === 0, `${missingCreatedBy.rows[0].c} event(s) still NULL`);

  const badTxnCurrency = await sql`SELECT COUNT(*)::int AS c FROM transactions WHERE currency NOT IN ('usd', 'wp')`;
  record('all transactions.currency within allowed set', badTxnCurrency.rows[0].c === 0, `${badTxnCurrency.rows[0].c} offending row(s)`);

  const badHoldCurrency = await sql`SELECT COUNT(*)::int AS c FROM escrow_holds WHERE currency NOT IN ('usd', 'wp')`;
  record('all escrow_holds.currency within allowed set', badHoldCurrency.rows[0].c === 0, `${badHoldCurrency.rows[0].c} offending row(s)`);

  const negativeWp = await sql`SELECT COUNT(*)::int AS c FROM wallets WHERE wp_balance < 0`;
  record('no wallet has a negative wp_balance', negativeWp.rows[0].c === 0, `${negativeWp.rows[0].c} offending row(s)`);
}

// Exercises the new schema against real writes, then rolls everything back. Nothing is persisted.
async function functionalChecks(): Promise<void> {
  console.log('\n16. functional checks (inside a transaction that is always rolled back)');

  const client = createClient();
  await client.connect();
  try {
    await client.sql`BEGIN`;

    const u = await client.sql`SELECT id FROM users LIMIT 1`;
    const e = await client.sql`SELECT id FROM events LIMIT 1`;
    if (u.rows.length === 0 || e.rows.length === 0) {
      record('functional checks', false, 'need at least one user and one event to exercise the schema');
      return;
    }
    const userId = u.rows[0].id as string;
    const eventId = e.rows[0].id as string;

    await client.sql`
      INSERT INTO escrow_holds (id, event_id, user_id, amount, status)
      VALUES ('verify-hold-1', ${eventId}, ${userId}, 25.00, 'held')
    `;
    record('escrow_holds accepts a valid hold', true);

    let rejected = false;
    try {
      await client.sql`
        INSERT INTO escrow_holds (id, event_id, user_id, amount, status)
        VALUES ('verify-hold-2', ${eventId}, ${userId}, -5.00, 'held')
      `;
    } catch {
      rejected = true;
    }
    record('escrow_holds_amount_check rejects a non-positive amount', rejected);

    // A failed statement aborts the transaction, so restart it before continuing.
    await client.sql`ROLLBACK`;
    await client.sql`BEGIN`;

    rejected = false;
    try {
      await client.sql`
        INSERT INTO escrow_holds (id, event_id, user_id, amount, status)
        VALUES ('verify-hold-3', ${eventId}, ${userId}, 5.00, 'bogus')
      `;
    } catch {
      rejected = true;
    }
    record('escrow_holds_status_check rejects an unknown status', rejected);

    await client.sql`ROLLBACK`;
    await client.sql`BEGIN`;

    await client.sql`
      INSERT INTO escrow_holds (id, event_id, user_id, amount, status, currency)
      VALUES ('verify-hold-wp-1', ${eventId}, ${userId}, 10.00, 'held', 'wp')
    `;
    record('escrow_holds accepts a wp-currency hold', true);

    rejected = false;
    try {
      await client.sql`
        INSERT INTO escrow_holds (id, event_id, user_id, amount, status, currency)
        VALUES ('verify-hold-badcur', ${eventId}, ${userId}, 10.00, 'held', 'eur')
      `;
    } catch {
      rejected = true;
    }
    record('escrow_holds_currency_check rejects an unknown currency', rejected);

    await client.sql`ROLLBACK`;
    await client.sql`BEGIN`;

    rejected = false;
    try {
      await client.sql`UPDATE events SET payment_type = 'crypto' WHERE id = ${eventId}`;
    } catch {
      rejected = true;
    }
    record('events_payment_type_check rejects an unknown payment type', rejected);

    await client.sql`ROLLBACK`;
    await client.sql`BEGIN`;

    await client.sql`UPDATE events SET payment_type = 'cash', stake_amount = 10.00, notify_subject = FALSE WHERE id = ${eventId}`;
    record('events accepts a cash bet with subject notifications off', true);

    rejected = false;
    try {
      await client.sql`
        INSERT INTO transactions (id, user_id, type, amount)
        VALUES ('verify-tx-1', ${userId}, 'not_a_type', 1.00)
      `;
    } catch {
      rejected = true;
    }
    record('transactions_type_check rejects an unknown type', rejected);

    await client.sql`ROLLBACK`;
    await client.sql`BEGIN`;

    await client.sql`
      INSERT INTO transactions (id, user_id, type, amount, idempotency_key, event_id)
      VALUES ('verify-tx-2', ${userId}, 'escrow_hold', 25.00, 'verify-key-1', ${eventId})
    `;
    record('transactions accepts escrow_hold with an idempotency key', true);
    const defaultedCurrency = await client.sql`SELECT currency FROM transactions WHERE id = 'verify-tx-2'`;
    record('transactions.currency defaults to usd when not specified', defaultedCurrency.rows[0]?.currency === 'usd');

    rejected = false;
    try {
      await client.sql`
        INSERT INTO transactions (id, user_id, type, amount, idempotency_key)
        VALUES ('verify-tx-3', ${userId}, 'payout', 25.00, 'verify-key-1')
      `;
    } catch {
      rejected = true;
    }
    record('idx_transactions_idempotency_key blocks a duplicate key', rejected);

    await client.sql`ROLLBACK`;
    await client.sql`BEGIN`;

    await client.sql`
      INSERT INTO transactions (id, user_id, type, amount, currency, idempotency_key, event_id)
      VALUES ('verify-tx-wp-1', ${userId}, 'deposit', 100.00, 'wp', 'verify-key-wp-1', ${eventId})
    `;
    record('transactions accepts a wp-currency deposit (signup-grant shape)', true);

    rejected = false;
    try {
      await client.sql`
        INSERT INTO transactions (id, user_id, type, amount, currency)
        VALUES ('verify-tx-badcur', ${userId}, 'deposit', 1.00, 'eur')
      `;
    } catch {
      rejected = true;
    }
    record('transactions_currency_check rejects an unknown currency', rejected);

    await client.sql`ROLLBACK`;
    await client.sql`BEGIN`;

    const c = await client.sql`SELECT id, event_id, user_id, username FROM comments LIMIT 1`;
    if (c.rows.length > 0) {
      const parent = c.rows[0];
      await client.sql`
        INSERT INTO comments (id, event_id, user_id, username, content, timestamp, parent_id)
        VALUES ('verify-reply-1', ${parent.event_id}, ${parent.user_id}, ${parent.username}, 'verification reply', 0, ${parent.id})
      `;
      record('comments accepts a threaded reply via parent_id', true);

      await client.sql`INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES (${parent.id}, ${userId}, '🔥')`;
      record('comment_reactions accepts a reaction', true);

      rejected = false;
      try {
        await client.sql`INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES (${parent.id}, ${userId}, '🔥')`;
      } catch {
        rejected = true;
      }
      record('comment_reactions rejects a duplicate (comment, user, emoji)', rejected);

      await client.sql`ROLLBACK`;
      await client.sql`BEGIN`;

      await client.sql`INSERT INTO comment_mentions (comment_id, mentioned_user_id) VALUES (${c.rows[0].id}, ${userId})`;
      record('comment_mentions accepts a mention', true);
    } else {
      record('comment threading checks', false, 'no comments in the database to thread from');
    }

    await client.sql`ROLLBACK`;
    await client.sql`BEGIN`;

    await client.sql`INSERT INTO event_notification_mutes (event_id, user_id, reason) VALUES (${eventId}, ${userId}, 'subject_hidden')`;
    record('event_notification_mutes accepts a subject_hidden mute', true);

    rejected = false;
    try {
      await client.sql`INSERT INTO event_notification_mutes (event_id, user_id, reason) VALUES (${eventId}, ${userId}, 'user_muted')`;
    } catch {
      rejected = true;
    }
    record('event_notification_mutes rejects a duplicate (event, user)', rejected);

    await client.sql`ROLLBACK`;
    await client.sql`BEGIN`;

    const prefs = await client.sql`SELECT categories FROM notification_preferences WHERE user_id = ${userId}`;
    const cats = prefs.rows.length > 0 ? (prefs.rows[0].categories as Record<string, boolean>) : null;
    const expectedCats = ['bets', 'comments', 'mentions', 'resolutions', 'invites', 'group_activity', 'payments'];
    const missingCats = cats ? expectedCats.filter((k) => !(k in cats)) : expectedCats;
    record('notification_preferences default categories are complete', cats !== null && missingCats.length === 0, missingCats.length ? `missing: ${missingCats.join(', ')}` : JSON.stringify(cats));
  } finally {
    try {
      await client.sql`ROLLBACK`;
    } catch {
      // transaction may already be closed; nothing was committed either way
    }
    await client.end();
  }
}

async function main(): Promise<void> {
  const who = await sql`SELECT current_database() AS db`;
  console.log(`🔎 Verifying comeback migration against "${who.rows[0].db}"\n`);

  await structuralChecks();
  await dataChecks();

  // Writing against a half-migrated schema just produces noise, so only exercise it once
  // every structural check has passed.
  if (results.every((r) => r.ok)) {
    await functionalChecks();
  } else {
    console.log('\n15. functional checks — skipped, schema is incomplete');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(60)}`);
  if (failed.length === 0) {
    console.log(`✅ All ${results.length} checks passed.`);
    return;
  }
  console.log(`❌ ${failed.length} of ${results.length} checks failed:`);
  for (const f of failed) console.log(`   - ${f.label}${f.detail ? ` (${f.detail})` : ''}`);
  console.log('\nRun `npm run db:migrate` to apply the comeback migration.');
  process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error('❌ Verification errored:', err);
    process.exit(1);
  });
