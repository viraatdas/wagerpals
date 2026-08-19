// "Comeback" migration: identity/auth, cash escrow, notification preferences,
// and threaded-comment support. Additive and idempotent — safe to run repeatedly.
import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

let applied = 0;
let skipped = 0;
// Steps that could not be applied because existing data blocks them. Tracked separately from
// `skipped` so the summary never reports a blocked step as an already-present no-op.
let blocked = 0;

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `;
  return res.rows.length > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const res = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return res.rows.length > 0;
}

async function indexExists(indexName: string): Promise<boolean> {
  const res = await sql`
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ${indexName}
  `;
  return res.rows.length > 0;
}

// Constraint names are only unique per table, so pg_constraint must be filtered by the owning
// relation (and its schema) — a bare conname match can report a same-named constraint on an
// unrelated table, making this migration skip a step it never actually applied.
async function constraintStatus(table: string, constraintName: string): Promise<{ exists: boolean; validated: boolean }> {
  const res = await sql`
    SELECT c.convalidated
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = ${table} AND c.conname = ${constraintName}
  `;
  if (res.rows.length === 0) return { exists: false, validated: false };
  return { exists: true, validated: res.rows[0].convalidated === true };
}

async function step(label: string, exists: () => Promise<boolean>, apply: () => Promise<unknown>): Promise<void> {
  if (await exists()) {
    console.log(`  ⏭  ${label} — already present, skipped`);
    skipped++;
  } else {
    await apply();
    console.log(`  ✅ ${label} — applied`);
    applied++;
  }
}

// Unique index on LOWER(email) must not be created if duplicate emails already exist,
// since the CREATE UNIQUE INDEX would fail. Detect and warn instead of aborting.
async function createUsersEmailUniqueIndex(): Promise<void> {
  const label = 'idx_users_email_lower';
  if (await indexExists(label)) {
    console.log(`  ⏭  ${label} — already present, skipped`);
    skipped++;
    return;
  }

  const dupes = await sql`
    SELECT LOWER(email) AS email_lower, COUNT(*) AS cnt
    FROM users
    WHERE email IS NOT NULL
    GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
    ORDER BY LOWER(email)
  `;

  if (dupes.rows.length > 0) {
    console.warn(`  ⚠️  WARNING: cannot create ${label} — duplicate emails found:`);
    for (const row of dupes.rows) {
      console.warn(`       - ${row.email_lower} (${row.cnt} users)`);
    }
    console.warn('     Run identity consolidation to merge/dedupe these accounts, then re-run this migration.');
    blocked++;
    return;
  }

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email)) WHERE email IS NOT NULL`;
  console.log(`  ✅ ${label} — applied`);
  applied++;
}

// transactions_type_check must cover both legacy and new transaction types. Existing rows may
// already violate it, so it is added NOT VALID first and validated separately; a validation
// failure is reported but does not abort the migration (new/updated rows are still checked).
async function addTransactionsTypeCheck(): Promise<void> {
  const label = 'transactions_type_check';
  const status = await constraintStatus('transactions', label);

  if (!status.exists) {
    await sql`
      ALTER TABLE transactions
      ADD CONSTRAINT transactions_type_check CHECK (type IN (
        'deposit', 'withdrawal', 'bet_placed', 'bet_refund', 'winnings',
        'escrow_hold', 'escrow_release', 'payout', 'refund'
      )) NOT VALID
    `;
    console.log(`  ✅ ${label} — added (NOT VALID)`);
    applied++;
  } else if (status.validated) {
    console.log(`  ⏭  ${label} — already present and validated, skipped`);
    skipped++;
    return;
  } else {
    console.log(`  ↻  ${label} — already present but not yet validated, retrying validation`);
  }

  try {
    await sql`ALTER TABLE transactions VALIDATE CONSTRAINT transactions_type_check`;
    console.log(`  ✅ ${label} — validated against existing rows`);
    if (status.exists) applied++;
  } catch (err) {
    console.warn(`  ⚠️  WARNING: ${label} failed validation against existing rows.`);
    const offending = await sql`
      SELECT id, type FROM transactions
      WHERE type NOT IN (
        'deposit', 'withdrawal', 'bet_placed', 'bet_refund', 'winnings',
        'escrow_hold', 'escrow_release', 'payout', 'refund'
      )
      LIMIT 20
    `;
    if (offending.rows.length > 0) {
      console.warn('     Existing transactions with a type outside the allowed set:');
      for (const row of offending.rows) {
        console.warn(`       - id=${row.id} type=${row.type}`);
      }
    }
    console.warn('     Constraint left NOT VALID: new/updated rows are enforced, existing rows are not.');
    console.warn('     Clean up the offending rows, then re-run this migration to validate.');
    blocked++;
  }
}

async function migrateComeback(): Promise<void> {
  console.log('🚀 Running comeback migration...\n');

  console.log('1. users: identity & auth columns');
  await step('users.email', () => columnExists('users', 'email'), () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
  await step('users.display_name', () => columnExists('users', 'display_name'), () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
  await step('users.avatar_url', () => columnExists('users', 'avatar_url'), () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
  await step('users.auth_methods', () => columnExists('users', 'auth_methods'), () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_methods JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await step('users.merged_into', () => columnExists('users', 'merged_into'), () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS merged_into TEXT REFERENCES users(id)`);
  await step('users.last_seen_at', () => columnExists('users', 'last_seen_at'), () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP`);

  console.log('\n2. users: indexes');
  await createUsersEmailUniqueIndex();
  await step('idx_users_merged_into', () => indexExists('idx_users_merged_into'), () => sql`CREATE INDEX IF NOT EXISTS idx_users_merged_into ON users(merged_into) WHERE merged_into IS NOT NULL`);
  await step('idx_users_last_seen_at', () => indexExists('idx_users_last_seen_at'), () => sql`CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users(last_seen_at DESC)`);

  console.log('\n3. events: payment columns');
  await step('events.payment_type', () => columnExists('events', 'payment_type'), () => sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'none'`);
  await step('events.stake_amount', () => columnExists('events', 'stake_amount'), () => sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS stake_amount DECIMAL(10,2)`);
  await step('events.subject_user_id', () => columnExists('events', 'subject_user_id'), () => sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS subject_user_id TEXT REFERENCES users(id)`);
  await step('events.notify_subject', () => columnExists('events', 'notify_subject'), () => sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS notify_subject BOOLEAN NOT NULL DEFAULT TRUE`);

  console.log('\n4. events: constraint & indexes');
  await step('events_payment_type_check', () => constraintStatus('events', 'events_payment_type_check').then((s) => s.exists), () => sql`ALTER TABLE events ADD CONSTRAINT events_payment_type_check CHECK (payment_type IN ('none', 'cash'))`);
  await step('idx_events_payment_type', () => indexExists('idx_events_payment_type'), () => sql`CREATE INDEX IF NOT EXISTS idx_events_payment_type ON events(payment_type)`);
  await step('idx_events_subject_user_id', () => indexExists('idx_events_subject_user_id'), () => sql`CREATE INDEX IF NOT EXISTS idx_events_subject_user_id ON events(subject_user_id) WHERE subject_user_id IS NOT NULL`);

  console.log('\n5. escrow_holds table');
  await step('escrow_holds table', () => tableExists('escrow_holds'), () => sql`
    CREATE TABLE IF NOT EXISTS escrow_holds (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      bet_id TEXT REFERENCES bets(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount DECIMAL(10,2) NOT NULL CONSTRAINT escrow_holds_amount_check CHECK (amount > 0),
      status TEXT NOT NULL DEFAULT 'held' CONSTRAINT escrow_holds_status_check CHECK (status IN ('held', 'released', 'refunded')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      released_at TIMESTAMP
    )
  `);

  console.log('\n6. escrow_holds: indexes');
  await step('idx_escrow_holds_bet_id', () => indexExists('idx_escrow_holds_bet_id'), () => sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_holds_bet_id ON escrow_holds(bet_id) WHERE bet_id IS NOT NULL`);
  await step('idx_escrow_holds_event_id', () => indexExists('idx_escrow_holds_event_id'), () => sql`CREATE INDEX IF NOT EXISTS idx_escrow_holds_event_id ON escrow_holds(event_id)`);
  await step('idx_escrow_holds_user_id', () => indexExists('idx_escrow_holds_user_id'), () => sql`CREATE INDEX IF NOT EXISTS idx_escrow_holds_user_id ON escrow_holds(user_id)`);
  await step('idx_escrow_holds_status', () => indexExists('idx_escrow_holds_status'), () => sql`CREATE INDEX IF NOT EXISTS idx_escrow_holds_status ON escrow_holds(status)`);

  console.log('\n7. bets: escrow_hold_id column & index');
  await step('bets.escrow_hold_id', () => columnExists('bets', 'escrow_hold_id'), () => sql`ALTER TABLE bets ADD COLUMN IF NOT EXISTS escrow_hold_id TEXT REFERENCES escrow_holds(id) ON DELETE SET NULL`);
  await step('idx_bets_escrow_hold_id', () => indexExists('idx_bets_escrow_hold_id'), () => sql`CREATE INDEX IF NOT EXISTS idx_bets_escrow_hold_id ON bets(escrow_hold_id) WHERE escrow_hold_id IS NOT NULL`);

  console.log('\n8. transactions: columns');
  await step('transactions.idempotency_key', () => columnExists('transactions', 'idempotency_key'), () => sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  await step('transactions.event_id', () => columnExists('transactions', 'event_id'), () => sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS event_id TEXT REFERENCES events(id) ON DELETE SET NULL`);

  console.log('\n9. transactions: type constraint');
  await addTransactionsTypeCheck();

  console.log('\n10. transactions: indexes');
  await step('idx_transactions_idempotency_key', () => indexExists('idx_transactions_idempotency_key'), () => sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency_key ON transactions(idempotency_key) WHERE idempotency_key IS NOT NULL`);
  await step('idx_transactions_event_id', () => indexExists('idx_transactions_event_id'), () => sql`CREATE INDEX IF NOT EXISTS idx_transactions_event_id ON transactions(event_id) WHERE event_id IS NOT NULL`);

  console.log('\n11. notification_preferences table');
  await step('notification_preferences table', () => tableExists('notification_preferences'), () => sql`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      categories JSONB NOT NULL DEFAULT '{"bets":true,"comments":true,"mentions":true,"resolutions":true,"invites":true,"group_activity":true,"payments":true}'::jsonb,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('\n12. event_notification_mutes table & indexes');
  await step('event_notification_mutes table', () => tableExists('event_notification_mutes'), () => sql`
    CREATE TABLE IF NOT EXISTS event_notification_mutes (
      id SERIAL PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL DEFAULT 'user_muted',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, user_id)
    )
  `);
  await step('idx_event_notification_mutes_event_id', () => indexExists('idx_event_notification_mutes_event_id'), () => sql`CREATE INDEX IF NOT EXISTS idx_event_notification_mutes_event_id ON event_notification_mutes(event_id)`);
  await step('idx_event_notification_mutes_user_id', () => indexExists('idx_event_notification_mutes_user_id'), () => sql`CREATE INDEX IF NOT EXISTS idx_event_notification_mutes_user_id ON event_notification_mutes(user_id)`);

  console.log('\n13. comments: columns');
  await step('comments.parent_id', () => columnExists('comments', 'parent_id'), () => sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE`);
  await step('comments.edited_at', () => columnExists('comments', 'edited_at'), () => sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP`);
  await step('comments.deleted_at', () => columnExists('comments', 'deleted_at'), () => sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);

  console.log('\n14. comments: indexes');
  await step('idx_comments_parent_id', () => indexExists('idx_comments_parent_id'), () => sql`CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id) WHERE parent_id IS NOT NULL`);
  await step('idx_comments_event_timestamp', () => indexExists('idx_comments_event_timestamp'), () => sql`CREATE INDEX IF NOT EXISTS idx_comments_event_timestamp ON comments(event_id, timestamp ASC)`);

  console.log('\n15. comment_reactions table & indexes');
  await step('comment_reactions table', () => tableExists('comment_reactions'), () => sql`
    CREATE TABLE IF NOT EXISTS comment_reactions (
      id SERIAL PRIMARY KEY,
      comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(comment_id, user_id, emoji)
    )
  `);
  await step('idx_comment_reactions_comment_id', () => indexExists('idx_comment_reactions_comment_id'), () => sql`CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment_id ON comment_reactions(comment_id)`);
  await step('idx_comment_reactions_user_id', () => indexExists('idx_comment_reactions_user_id'), () => sql`CREATE INDEX IF NOT EXISTS idx_comment_reactions_user_id ON comment_reactions(user_id)`);

  console.log('\n16. comment_mentions table & indexes');
  await step('comment_mentions table', () => tableExists('comment_mentions'), () => sql`
    CREATE TABLE IF NOT EXISTS comment_mentions (
      id SERIAL PRIMARY KEY,
      comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      mentioned_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(comment_id, mentioned_user_id)
    )
  `);
  await step('idx_comment_mentions_comment_id', () => indexExists('idx_comment_mentions_comment_id'), () => sql`CREATE INDEX IF NOT EXISTS idx_comment_mentions_comment_id ON comment_mentions(comment_id)`);
  await step('idx_comment_mentions_mentioned_user_id', () => indexExists('idx_comment_mentions_mentioned_user_id'), () => sql`CREATE INDEX IF NOT EXISTS idx_comment_mentions_mentioned_user_id ON comment_mentions(mentioned_user_id)`);

  console.log('\n17. groups: cash_enabled column');
  await step('groups.cash_enabled', () => columnExists('groups', 'cash_enabled'), () => sql`ALTER TABLE groups ADD COLUMN IF NOT EXISTS cash_enabled BOOLEAN NOT NULL DEFAULT FALSE`);

  console.log('\n18. events: created_by column, index & backfill');
  await step('events.created_by', () => columnExists('events', 'created_by'), () => sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id)`);
  await step('idx_events_created_by', () => indexExists('idx_events_created_by'), () => sql`CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by) WHERE created_by IS NOT NULL`);

  // R2: only the event's creator may resolve/unresolve/cancel/delete it, with
  // the event's group.created_by as the fallback for legacy rows. Backfilling
  // NULL created_by to the owning group's creator means every pre-existing
  // event already has a well-defined resolver the moment this migration
  // lands, instead of relying on every route remembering the NULL fallback.
  // Idempotent: only touches rows still NULL, safe to re-run.
  const createdByBackfilled = await sql`
    UPDATE events e
    SET created_by = g.created_by
    FROM groups g
    WHERE e.group_id = g.id AND e.created_by IS NULL
    RETURNING e.id
  `;
  if (createdByBackfilled.rows.length > 0) {
    console.log(`  ✅ events.created_by backfill — updated ${createdByBackfilled.rows.length} row(s) from their group's created_by`);
    applied++;
  } else {
    console.log('  ⏭  events.created_by backfill — 0 rows needed, skipped');
    skipped++;
  }

  console.log('\n19. backfill: notification_preferences for existing users');
  const backfilled = await sql`
    INSERT INTO notification_preferences (user_id)
    SELECT id FROM users
    WHERE id NOT IN (SELECT user_id FROM notification_preferences)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING user_id
  `;
  if (backfilled.rows.length > 0) {
    console.log(`  ✅ notification_preferences backfill — created ${backfilled.rows.length} row(s)`);
    applied++;
  } else {
    console.log('  ⏭  notification_preferences backfill — 0 rows needed, skipped');
    skipped++;
  }

  if (blocked > 0) {
    console.log(`\n⚠️  Migration finished with warnings: ${applied} change(s) newly applied, ${skipped} already present, ${blocked} blocked by existing data (see warnings above).`);
    console.log('   Resolve the data issues and re-run this migration; run `npm run db:verify` to confirm.');
  } else {
    console.log(`\n🎉 Migration complete: ${applied} change(s) newly applied, ${skipped} already present (no-op).`);
  }
}

migrateComeback()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
