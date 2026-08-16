// Proof that constraintStatus() in scripts/migrate-comeback.ts is scoped to the
// table that owns the constraint.
//
// The bug: constraintStatus() matched `pg_constraint.conname` with no table or
// schema filter. Constraint names are only unique *per relation*, so a lookup
// for `foo_type_check` would happily match a same-named constraint on an
// unrelated table (or in a non-public schema). Two concrete consequences in the
// migration:
//   1. step() logs "already present, skipped" for a constraint the target table
//      never received — a silently missing constraint on a live database.
//   2. addTransactionsTypeCheck() reads another table's `convalidated` flag and
//      concludes the transactions check is validated when it is not.
//
// The fix: join pg_class + pg_namespace and filter on
// nspname='public' AND relname=$table AND conname=$constraint — the same
// schema-scoped idiom columnExists/tableExists/indexExists already use.
//
// SAFETY: every object this script creates is named zz_probe_* and is dropped in
// a finally block. It never reads, writes or alters application tables, and it
// never creates or drops a constraint on one.
//
// Run: npx tsx scripts/verify-constraint-status.ts   (or: npm run verify:constraints)

import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';

dotenv.config({ path: '.env.local' });

let totalChecks = 0;
let failedChecks = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  totalChecks++;
  if (condition) {
    console.log(`    ✅ ${message}`);
  } else {
    failedChecks++;
    failures.push(message);
    console.log(`    ❌ ${message}`);
  }
}

function section(title: string): void {
  console.log(`\n▶ ${title}`);
}

// --- the two implementations, side by side ------------------------------------

/** The OLD, unfiltered lookup this fix replaced. Kept here only to demonstrate it. */
async function constraintStatusOld(constraintName: string): Promise<{ exists: boolean; validated: boolean; matches: number }> {
  const res = await sql`SELECT convalidated FROM pg_constraint WHERE conname = ${constraintName}`;
  if (res.rows.length === 0) return { exists: false, validated: false, matches: 0 };
  return { exists: true, validated: res.rows[0].convalidated === true, matches: res.rows.length };
}

/** The shipped lookup, mirroring scripts/migrate-comeback.ts exactly. */
async function constraintStatusNew(table: string, constraintName: string): Promise<{ exists: boolean; validated: boolean }> {
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

// --- probe fixtures -----------------------------------------------------------

const DECOY_TABLE = 'zz_probe_decoy';
const TARGET_TABLE = 'zz_probe_target';
const PROBE_SCHEMA = 'zz_probe_schema';
const SHARED_NAME = 'zz_probe_shared_check';

async function teardown(): Promise<void> {
  await sql.query(`DROP TABLE IF EXISTS public.${DECOY_TABLE}`);
  await sql.query(`DROP TABLE IF EXISTS public.${TARGET_TABLE}`);
  await sql.query(`DROP SCHEMA IF EXISTS ${PROBE_SCHEMA} CASCADE`);
}

async function main(): Promise<void> {
  console.log('\n🔍 constraintStatus() is scoped to its owning table\n');

  // -------------------------------------------------------------------------
  section('The shipped source carries the fix');
  const source = readFileSync(join(process.cwd(), 'scripts/migrate-comeback.ts'), 'utf8');
  assert(
    /async function constraintStatus\(table: string, constraintName: string\)/.test(source),
    'constraintStatus() takes the owning table as its first argument'
  );
  assert(
    source.includes("n.nspname = 'public'") && source.includes('t.relname = ${table}'),
    'the query filters on schema and relation, not just conname'
  );
  assert(
    !/WHERE conname = \$\{constraintName\}/.test(source),
    'the old bare-conname query is gone'
  );
  assert(
    source.includes("constraintStatus('transactions', label)"),
    'addTransactionsTypeCheck() passes the transactions table'
  );
  assert(
    source.includes("constraintStatus('events', 'events_payment_type_check')"),
    'the events_payment_type_check step passes the events table'
  );

  try {
    await sql.query(`CREATE TABLE public.${DECOY_TABLE} (n INT)`);
    await sql.query(`CREATE TABLE public.${TARGET_TABLE} (n INT)`);
    await sql.query(
      `ALTER TABLE public.${DECOY_TABLE} ADD CONSTRAINT ${SHARED_NAME} CHECK (n > 0)`
    );

    // -----------------------------------------------------------------------
    section('A same-named constraint on another table is not mistaken for ours');
    const oldCrossTable = await constraintStatusOld(SHARED_NAME);
    assert(oldCrossTable.exists, `OLD: reports ${SHARED_NAME} as present (it only exists on the decoy)`);

    const newOnDecoy = await constraintStatusNew(DECOY_TABLE, SHARED_NAME);
    const newOnTarget = await constraintStatusNew(TARGET_TABLE, SHARED_NAME);
    assert(newOnDecoy.exists, 'NEW: finds the constraint on the table that actually owns it');
    assert(!newOnTarget.exists, 'NEW: does NOT find it on the table that lacks it');

    // -----------------------------------------------------------------------
    section('A duplicate name across tables is no longer ambiguous');
    await sql.query(
      `ALTER TABLE public.${TARGET_TABLE} ADD CONSTRAINT ${SHARED_NAME} CHECK (n < 100)`
    );
    const oldDuplicated = await constraintStatusOld(SHARED_NAME);
    assert(oldDuplicated.matches === 2, `OLD: matches 2 rows for one name (got ${oldDuplicated.matches})`);
    assert(
      (await constraintStatusNew(DECOY_TABLE, SHARED_NAME)).exists &&
        (await constraintStatusNew(TARGET_TABLE, SHARED_NAME)).exists,
      'NEW: resolves each table independently, one row each'
    );

    // -----------------------------------------------------------------------
    section('A constraint in another schema does not leak in');
    await sql.query(`ALTER TABLE public.${TARGET_TABLE} DROP CONSTRAINT ${SHARED_NAME}`);
    await sql.query(`DROP TABLE public.${DECOY_TABLE}`);
    await sql.query(`CREATE SCHEMA ${PROBE_SCHEMA}`);
    await sql.query(`CREATE TABLE ${PROBE_SCHEMA}.${TARGET_TABLE} (n INT)`);
    await sql.query(
      `ALTER TABLE ${PROBE_SCHEMA}.${TARGET_TABLE} ADD CONSTRAINT ${SHARED_NAME} CHECK (n > 0)`
    );

    const oldCrossSchema = await constraintStatusOld(SHARED_NAME);
    assert(oldCrossSchema.exists, 'OLD: matches a constraint living in a non-public schema');
    assert(
      !(await constraintStatusNew(TARGET_TABLE, SHARED_NAME)).exists,
      'NEW: ignores the non-public schema and reports the public table as lacking it'
    );

    // -----------------------------------------------------------------------
    section('The migration would no longer skip a step it never applied');
    // This is step()'s exact decision: exists() true => "already present, skipped".
    const oldWouldSkip = (await constraintStatusOld(SHARED_NAME)).exists;
    const newWouldSkip = (await constraintStatusNew(TARGET_TABLE, SHARED_NAME)).exists;
    assert(oldWouldSkip, 'OLD: step() would log "already present, skipped" — leaving public table unconstrained');
    assert(!newWouldSkip, 'NEW: step() would apply the constraint, as it must');

    // -----------------------------------------------------------------------
    section("The real schema's constraints resolve on their own tables only");
    const txOnTransactions = await constraintStatusNew('transactions', 'transactions_type_check');
    const txOnEvents = await constraintStatusNew('events', 'transactions_type_check');
    assert(txOnTransactions.exists, 'transactions_type_check is found on transactions');
    assert(txOnTransactions.validated, 'transactions_type_check is validated');
    assert(!txOnEvents.exists, 'transactions_type_check is not reported on events');

    const evOnEvents = await constraintStatusNew('events', 'events_payment_type_check');
    const evOnTransactions = await constraintStatusNew('transactions', 'events_payment_type_check');
    assert(evOnEvents.exists, 'events_payment_type_check is found on events');
    assert(!evOnTransactions.exists, 'events_payment_type_check is not reported on transactions');
  } finally {
    section('Cleanup');
    await teardown();
    const leftovers = await sql`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname LIKE 'zz_probe%' OR n.nspname = 'zz_probe_schema'
    `;
    assert(leftovers.rows.length === 0, `all probe objects removed (${leftovers.rows.length} left)`);
  }

  console.log(`\n=== ${totalChecks - failedChecks}/${totalChecks} checks passed ===\n`);
  if (failedChecks > 0) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n💥 verification crashed:', err);
  process.exit(1);
});
