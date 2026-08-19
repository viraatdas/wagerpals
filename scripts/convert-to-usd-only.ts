// One-time conversion: WagerPals moves from two ledgers (usd + the W) to a
// single usd ledger. This script does exactly two things per user, each
// inside its own transaction:
//
//   1. Zeroes wallets.wp_balance — the W is retired; nobody's wp_balance
//      should read as spendable currency going forward. This wallet touch
//      does NOT itself lazily grant the usd seed (that's ensureWallet's job,
//      called explicitly in step 2) and does NOT delete any wp transaction
//      history — the ledger rows that funded the old wp_balance (signup
//      grants, faucet grants, W bets/settlements) stay exactly where they
//      are, for audit purposes. Only the live balance is zeroed.
//   2. Ensures the $10 signup-credit seed exists, using the SAME idempotent
//      mechanism lib/payments.ts's applyUsdSeedIfNeeded uses: insert a
//      transaction with idempotency_key 'usd-seed:<userId>' via
//      ON CONFLICT (idempotency_key) DO NOTHING, and credit wallets.balance
//      only if the insert actually happened. A user who already has this
//      key (e.g. because they touched their wallet after the code deploy
//      but before this script ran) is left untouched — no double credit.
//
// This script does NOT touch usd `balance` beyond that one seed credit, and
// does NOT delete any transaction/escrow_holds/bets history.
//
// Runs once per row in `users` (merged_into IS NULL — tombstoned duplicates
// are skipped, they are not live accounts), not just rows that already have
// a `wallets` row — so a user who never touched their wallet before this
// script also gets a wallet row created (balance 0) and then seeded to $10,
// exactly like their first lazy touch would have done.
//
// Usage:
//   npx tsx scripts/convert-to-usd-only.ts            # dry run (default) — prints the plan, writes nothing
//   npx tsx scripts/convert-to-usd-only.ts --apply     # execute the conversion
//   npx tsx scripts/convert-to-usd-only.ts --help

import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

loadEnv({ path: resolve(process.cwd(), '.env.local') });

import { sql } from '@vercel/postgres';
import { withTransaction } from '@/lib/db';
import { generateId } from '@/lib/utils';

const HELP_TEXT = `
Convert WagerPals to a single usd ledger: zero every wp_balance, ensure every
live user has the $10 signup-credit seed.

Usage:
  npx tsx scripts/convert-to-usd-only.ts            Dry run (default) — prints what would change
  npx tsx scripts/convert-to-usd-only.ts --apply     Write changes to the database
  npx tsx scripts/convert-to-usd-only.ts --help      Show this help

Requires POSTGRES_URL in the environment (.env.local).
`;

const SIGNUP_SEED_USD = 10;

function usdSeedKey(userId: string): string {
  return `usd-seed:${userId}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

interface UserRow {
  id: string;
  username: string;
}

async function main(): Promise<void> {
  const { apply, help } = parseArgs();

  if (help) {
    console.log(HELP_TEXT);
    return;
  }

  if (!process.env.POSTGRES_URL) {
    console.error('❌ POSTGRES_URL is not set. Add it to .env.local or the environment.');
    process.exit(1);
  }

  console.log('='.repeat(78));
  console.log(`  convert-to-usd-only — ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log('='.repeat(78));

  const usersResult = await sql<UserRow>`
    SELECT id, username FROM users WHERE merged_into IS NULL ORDER BY id
  `;
  const users = usersResult.rows;
  console.log(`\nFound ${users.length} live user(s) (merged_into IS NULL).\n`);

  let walletsCreated = 0;
  let wpBalancesCleared = 0;
  let wpTotalCleared = 0;
  let seedsGranted = 0;
  let seedsAlreadyPresent = 0;
  let usersUnchanged = 0;

  for (const user of users) {
    if (!apply) {
      // Dry run: read-only, mirrors the same decisions the apply path makes
      // without writing anything.
      const walletResult = await sql`SELECT wp_balance FROM wallets WHERE user_id = ${user.id}`;
      const hasWallet = walletResult.rows.length > 0;
      const wpBalance = hasWallet ? parseFloat(walletResult.rows[0].wp_balance) : 0;
      const seedResult = await sql`
        SELECT 1 FROM transactions WHERE idempotency_key = ${usdSeedKey(user.id)}
      `;
      const hasSeed = seedResult.rows.length > 0;

      if (!hasWallet) walletsCreated++;
      if (wpBalance !== 0) {
        wpBalancesCleared++;
        wpTotalCleared += wpBalance;
      }
      if (hasSeed) {
        seedsAlreadyPresent++;
      } else {
        seedsGranted++;
      }
      if (hasWallet && wpBalance === 0 && hasSeed) usersUnchanged++;
      continue;
    }

    // Apply: one transaction per user, exactly as the spec requires.
    const outcome = await withTransaction(async (tx) => {
      const walletInsert = await tx.sql`
        INSERT INTO wallets (user_id, balance, wp_balance, currency)
        VALUES (${user.id}, 0, 0, 'usd')
        ON CONFLICT (user_id) DO NOTHING
        RETURNING user_id
      `;
      const walletCreated = walletInsert.rows.length > 0;

      const walletBefore = await tx.sql`SELECT wp_balance FROM wallets WHERE user_id = ${user.id} FOR UPDATE`;
      const wpBalanceBefore = parseFloat(walletBefore.rows[0].wp_balance);

      if (wpBalanceBefore !== 0) {
        await tx.sql`
          UPDATE wallets SET wp_balance = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ${user.id}
        `;
      }

      const seedInsert = await tx.sql`
        INSERT INTO transactions (id, user_id, type, amount, status, description, idempotency_key, currency)
        VALUES (${generateId()}, ${user.id}, 'deposit', ${SIGNUP_SEED_USD}, 'completed', 'Signup credit', ${usdSeedKey(user.id)}, 'usd')
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
        RETURNING id
      `;
      const seeded = seedInsert.rows.length > 0;
      if (seeded) {
        await tx.sql`
          UPDATE wallets SET balance = balance + ${SIGNUP_SEED_USD}, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ${user.id}
        `;
      }

      return { walletCreated, wpBalanceBefore, seeded };
    });

    if (outcome.walletCreated) walletsCreated++;
    if (outcome.wpBalanceBefore !== 0) {
      wpBalancesCleared++;
      wpTotalCleared += outcome.wpBalanceBefore;
    }
    if (outcome.seeded) {
      seedsGranted++;
    } else {
      seedsAlreadyPresent++;
    }
    if (!outcome.walletCreated && outcome.wpBalanceBefore === 0 && !outcome.seeded) usersUnchanged++;
  }

  console.log('Summary:');
  console.log(`  users processed:        ${users.length}`);
  console.log(`  wallets newly created:   ${walletsCreated}`);
  console.log(`  wp_balance cleared:      ${wpBalancesCleared} user(s), W${wpTotalCleared.toFixed(2)} total zeroed`);
  console.log(`  $10 seed newly granted:  ${seedsGranted}`);
  console.log(`  $10 seed already present:${' '.repeat(1)}${seedsAlreadyPresent}`);
  console.log(`  users fully unchanged:   ${usersUnchanged}`);
  console.log('');
  if (!apply) {
    console.log('Dry run only — re-run with --apply to write these changes.');
  } else {
    console.log('Applied.');
  }
  console.log('='.repeat(78));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFATAL:', err);
    process.exit(1);
  });
