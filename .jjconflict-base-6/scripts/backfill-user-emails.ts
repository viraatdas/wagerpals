// Backfills users.email (and display_name, avatar_url, auth_methods) for
// existing rows from Stack Auth, so identity can actually be keyed on email.
//
// Only ever writes a *verified* primary email — identity consolidation
// depends on email being trustworthy, and an unverified address must never
// be able to claim (or merge into) an existing account.
//
// Usage:
//   npx tsx scripts/backfill-user-emails.ts            # dry run (default)
//   npx tsx scripts/backfill-user-emails.ts --apply     # write changes
//   npx tsx scripts/backfill-user-emails.ts --help
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

loadEnv({ path: resolve(process.cwd(), '.env.local') });

import { StackServerApp, type ServerUser } from '@stackframe/stack';
import { db } from '@/lib/db';
import type { AuthMethod, User } from '@/lib/types';

const HELP_TEXT = `
Backfill users.email / display_name / avatar_url / auth_methods from Stack Auth.

Usage:
  npx tsx scripts/backfill-user-emails.ts            Dry run (default) — prints what would change
  npx tsx scripts/backfill-user-emails.ts --apply     Write changes to the database
  npx tsx scripts/backfill-user-emails.ts --help      Show this help

For every live user row (merged_into IS NULL) with email IS NULL, this looks the
row's id up in Stack Auth. If Stack Auth reports a *verified* primary email that
is not already held by a different row, it is written onto the row (lowercased),
along with display_name/avatar_url (when locally empty) and auth_methods
(merged, never overwritten).

Requires in the environment (.env.local):
  POSTGRES_URL
  NEXT_PUBLIC_STACK_PROJECT_ID
  STACK_SECRET_SERVER_KEY
  NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
`;

const REQUIRED_ENV_VARS = [
  'POSTGRES_URL',
  'NEXT_PUBLIC_STACK_PROJECT_ID',
  'STACK_SECRET_SERVER_KEY',
  'NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY',
] as const;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function missingEnvVars(): string[] {
  return REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
}

// Mirrors the derivation used by lib/sync-user.ts's syncUser() so rows
// created by that path and rows backfilled by this script end up with the
// same shape of auth_methods data. (Not imported directly: those helpers are
// module-private, and lib/sync-user.ts's AuthenticatedStackUser type doesn't
// match the ServerUser shape returned by StackServerApp#getUser here.)
function buildAuthMethodsFromStackUser(stackUser: ServerUser, email: string | null): AuthMethod[] {
  const methods: AuthMethod[] = [];

  if (stackUser.hasPassword) {
    methods.push({ provider: 'password', identifier: email });
  }
  for (const provider of stackUser.oauthProviders) {
    if (provider.id === 'google') {
      methods.push({ provider: 'google', identifier: email });
    } else if (provider.id === 'apple') {
      methods.push({ provider: 'apple', identifier: email });
    } else {
      methods.push({ provider: 'other', identifier: provider.id });
    }
  }
  if (stackUser.passkeyAuthEnabled) {
    methods.push({ provider: 'passkey', identifier: email });
  }
  if (stackUser.otpAuthEnabled) {
    methods.push({ provider: 'stack', identifier: email });
  }
  if (methods.length === 0) {
    methods.push({ provider: 'stack', identifier: email });
  }
  return methods;
}

function authMethodKey(m: AuthMethod): string {
  return `${m.provider}:${m.identifier ?? ''}`;
}

// Union existing auth methods with newly-observed ones, de-duplicated on
// provider+identifier. Entries that already existed keep their original
// linked_at; newly-added entries are stamped with `now`.
function mergeAuthMethods(existing: AuthMethod[], incoming: AuthMethod[]): AuthMethod[] {
  const merged = new Map<string, AuthMethod>();
  for (const m of existing) {
    merged.set(authMethodKey(m), m);
  }
  const nowIso = new Date().toISOString();
  for (const m of incoming) {
    const key = authMethodKey(m);
    if (!merged.has(key)) {
      merged.set(key, { ...m, linked_at: nowIso });
    }
  }
  return Array.from(merged.values());
}

function authMethodsChanged(existing: AuthMethod[], merged: AuthMethod[]): boolean {
  if (existing.length !== merged.length) return true;
  const existingKeys = new Set(existing.map(authMethodKey));
  return merged.some((m) => !existingKeys.has(authMethodKey(m)));
}

type Counts = {
  scanned: number;
  written: number;
  already_had_email: number;
  unverified: number;
  unresolvable: number;
  conflict: number;
};

async function main() {
  const { apply, help } = parseArgs();

  if (help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const missing = missingEnvVars();
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    for (const name of missing) {
      console.error(`   - ${name}`);
    }
    console.error('\nSet these in .env.local before running this script.');
    process.exit(1);
  }

  const stack = new StackServerApp({
    tokenStore: null,
    projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID!,
    publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY!,
    secretServerKey: process.env.STACK_SECRET_SERVER_KEY!,
  });

  console.log(apply ? '🚀 Backfilling user emails (APPLY — writes will be made)...\n' : '🔍 Backfilling user emails (DRY RUN — pass --apply to write changes)...\n');

  const counts: Counts = {
    scanned: 0,
    written: 0,
    already_had_email: 0,
    unverified: 0,
    unresolvable: 0,
    conflict: 0,
  };

  const unverifiedRows: string[] = [];
  const unresolvableRows: string[] = [];
  const conflictRows: string[] = [];

  // getAll() already excludes tombstoned (merged_into IS NOT NULL) rows.
  const liveUsers: User[] = await db.users.getAll();

  for (const existing of liveUsers) {
    counts.scanned++;

    if (existing.email) {
      counts.already_had_email++;
      continue;
    }

    let stackUser: ServerUser | null;
    try {
      stackUser = await stack.getUser(existing.id);
    } catch (err: any) {
      counts.unresolvable++;
      // Stack Auth ids are UUIDs; a "must be a valid UUID" validation error
      // means this id was never a Stack Auth id to begin with — a legacy
      // pre-Stack row, same as a clean "not found" — not a transient failure.
      const errMsg: string = err?.message ?? String(err);
      const reason = /must be a valid uuid/i.test(errMsg)
        ? 'id is not a Stack Auth id (not a UUID) — legacy pre-Stack row'
        : `error contacting Stack Auth: ${errMsg}`;
      const msg = `id=${existing.id} username=${existing.username} (${reason})`;
      unresolvableRows.push(msg);
      console.log(`  ⏭  ${msg}`);
      continue;
    }

    if (!stackUser) {
      counts.unresolvable++;
      const msg = `id=${existing.id} username=${existing.username} (no Stack Auth account — legacy pre-Stack row)`;
      unresolvableRows.push(msg);
      console.log(`  ⏭  ${msg}`);
      continue;
    }

    const verified = stackUser.primaryEmailVerified && !!stackUser.primaryEmail;
    if (!verified) {
      counts.unverified++;
      const msg = `id=${existing.id} username=${existing.username} (Stack Auth email ${stackUser.primaryEmail ? 'not verified' : 'not set'})`;
      unverifiedRows.push(msg);
      console.log(`  ⏭  ${msg}`);
      continue;
    }

    const email = stackUser.primaryEmail!.trim().toLowerCase();

    // idx_users_email_lower is a UNIQUE index — never write an email onto
    // this row that a *different* row already owns. getByEmail also returns
    // tombstoned rows, which is correct: a merged account's email must not
    // be handed to a different human either.
    const owner = await db.users.getByEmail(email);
    if (owner && owner.id !== existing.id) {
      counts.conflict++;
      const msg = `${email}: held by ${owner.id} (${owner.username}), also matches ${existing.id} (${existing.username})`;
      conflictRows.push(msg);
      console.log(`  ❌ CONFLICT ${msg}`);
      console.log(`     → Run: npx tsx scripts/merge-duplicate-users.ts --email ${email}`);
      continue;
    }

    const patch: Partial<User> = { email };

    const displayName = stackUser.displayName?.trim();
    if (!existing.display_name && displayName) {
      patch.display_name = displayName;
    }

    const avatarUrl = stackUser.profileImageUrl?.trim();
    if (!existing.avatar_url && avatarUrl) {
      patch.avatar_url = avatarUrl;
    }

    const incomingMethods = buildAuthMethodsFromStackUser(stackUser, email);
    const mergedMethods = mergeAuthMethods(existing.auth_methods || [], incomingMethods);
    if (authMethodsChanged(existing.auth_methods || [], mergedMethods)) {
      patch.auth_methods = mergedMethods;
    }

    counts.written++;
    console.log(`  ✅ ${apply ? 'set' : 'would set'} email=${email} for id=${existing.id} username=${existing.username}`);

    if (apply) {
      await db.users.update(existing.id, patch);
    }
  }

  console.log('\n📊 Summary');
  console.log(`   scanned:            ${counts.scanned}`);
  console.log(`   written:            ${counts.written}`);
  console.log(`   already_had_email:  ${counts.already_had_email}`);
  console.log(`   unverified:         ${counts.unverified}`);
  console.log(`   unresolvable:       ${counts.unresolvable}`);
  console.log(`   conflict:           ${counts.conflict}`);

  if (unresolvableRows.length > 0) {
    console.log('\nUnresolvable (no Stack Auth account found — legacy pre-Stack rows):');
    for (const row of unresolvableRows) console.log(`   - ${row}`);
  }

  if (unverifiedRows.length > 0) {
    console.log('\nUnverified (Stack Auth account exists but email is not verified):');
    for (const row of unverifiedRows) console.log(`   - ${row}`);
  }

  if (conflictRows.length > 0) {
    console.log('\nConflicts (email already owned by a different row — needs a manual merge):');
    for (const row of conflictRows) console.log(`   - ${row}`);
  }

  if (!apply && counts.written > 0) {
    console.log(`\nThis was a dry run — ${counts.written} row(s) would be written. Re-run with --apply to write them.`);
  }

  console.log(apply ? '\n🎉 Backfill complete.' : '\n🎉 Dry run complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err?.message ?? err);
  process.exit(1);
});
