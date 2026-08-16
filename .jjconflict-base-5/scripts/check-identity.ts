// The runnable proof for "one human = one WagerPals account".
//
// Part A (security assertions) needs no database and no network, and must
// always run: it imports the route handler directly and calls it with a
// fabricated unauthenticated request, asserting the auth check rejects it
// before anything else happens.
//
// Part B (database consistency) is skipped with a clear message when
// POSTGRES_URL is not set; otherwise it queries the live database for
// duplicate identities, missing emails, broken tombstones, and positive
// evidence of multi-provider accounts landing on one row.
//
// Usage:
//   npx tsx scripts/check-identity.ts
import { config as loadEnv } from 'dotenv';
import { resolve, relative } from 'path';

loadEnv({ path: resolve(process.cwd(), '.env.local') });

import { readFileSync, readdirSync, statSync } from 'fs';
import { NextRequest } from 'next/server';
import { POST, GET } from '@/app/api/users/route';
import { getAuthenticatedUserId } from '@/lib/auth';

// GET is imported (unused) alongside POST to document that the whole route
// module — not just POST — loads cleanly under tsx outside a Next.js
// server bundle. Part A intentionally never invokes GET: it would touch the
// database, and Part A must run without one.
void GET;

let overallOk = true;

function heading(title: string) {
  console.log(`\n=== ${title} ===\n`);
}

// Recursively collect files under `dir` (skipping node_modules/.next/.git)
// whose contents include `needle`. Used by Assert 6 to check, informationally,
// which client files still send the now-inert x-stack-user-id header.
const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);
const SCAN_EXTS = ['.ts', '.tsx', '.js', '.jsx'];

function findFilesContaining(dir: string, needle: string): string[] {
  let matches: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return matches;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = `${dir}/${entry}`;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      matches = matches.concat(findFilesContaining(full, needle));
    } else if (SCAN_EXTS.some((ext) => entry.endsWith(ext))) {
      try {
        if (readFileSync(full, 'utf8').includes(needle)) {
          matches.push(full);
        }
      } catch {
        // unreadable file — skip
      }
    }
  }
  return matches;
}

async function runPartA(): Promise<boolean> {
  heading('Part A — security assertions (no DB, no network)');
  let pass = true;

  // Assert 1 & 2: an unauthenticated POST carrying an attacker-supplied id
  // and username must be rejected with 401 before it ever reaches the
  // database. Before the fix, this reached the database and would have
  // created or renamed an arbitrary user.
  try {
    const req = new NextRequest('http://localhost:3000/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'attacker-id', username: 'victim' }),
    });
    const res = await POST(req);
    const status = res.status;
    const body = await res.json().catch(() => null);

    if (status === 401) {
      console.log(`✅ PASS  Assert 1: unauthenticated POST {id:'attacker-id', username:'victim'} → 401 (observed: ${status})`);
    } else if (status === 500) {
      pass = false;
      console.log(`❌ FAIL  Assert 1: expected 401, observed 500 — this means auth is being checked AFTER the database is touched (a Postgres/server error surfaced instead of a clean 401)`);
    } else {
      pass = false;
      console.log(`❌ FAIL  Assert 1: expected 401, observed ${status}`);
    }

    const expectedBody = { error: 'Authentication required' };
    if (body && typeof body === 'object' && body.error === expectedBody.error) {
      console.log(`✅ PASS  Assert 2: 401 body is ${JSON.stringify(expectedBody)} (observed: ${JSON.stringify(body)})`);
    } else {
      pass = false;
      console.log(`❌ FAIL  Assert 2: expected body ${JSON.stringify(expectedBody)}, observed ${JSON.stringify(body)}`);
    }
  } catch (err: any) {
    pass = false;
    console.log(`❌ FAIL  Assert 1: unauthenticated POST threw instead of returning a response — ${err?.message ?? err}`);
    console.log(`❌ FAIL  Assert 2: (skipped — no response to inspect)`);
  }

  // Assert 3: auth is checked before ANY body validation, so even a request
  // with an empty body must still come back 401, not a 400.
  try {
    const req = new NextRequest('http://localhost:3000/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    const status = res.status;

    if (status === 401) {
      console.log(`✅ PASS  Assert 3: unauthenticated POST {} (empty body) → 401 (observed: ${status})`);
    } else if (status === 500) {
      pass = false;
      console.log(`❌ FAIL  Assert 3: expected 401, observed 500 — this means auth is being checked AFTER the database/body is touched`);
    } else {
      pass = false;
      console.log(`❌ FAIL  Assert 3: expected 401, observed ${status}`);
    }
  } catch (err: any) {
    pass = false;
    console.log(`❌ FAIL  Assert 3: unauthenticated POST {} threw instead of returning a response — ${err?.message ?? err}`);
  }

  console.log('\nℹ️  Note on Asserts 1/3/5: under tsx (this script\'s runtime), lib/stack.ts\'s `import');
  console.log('   "server-only"` throws before Stack Auth is ever contacted; lib/auth.ts\'s try/catch');
  console.log('   treats that as "unauthenticated" and fails closed to 401. Stack Auth itself is never');
  console.log('   actually reached here. What this DOES prove: auth is evaluated and rejected before the');
  console.log('   database is ever touched — the pre-fix code hit the database directly, which is exactly');
  console.log('   why a 500/Postgres error (rather than a clean 401) is treated as a FAIL above. It does');
  console.log('   NOT exercise a live, valid Stack Auth session — that still requires a running app with a');
  console.log('   real session/token.');

  // Assert 4: a forged x-stack-user-id header must NOT authenticate the
  // request. This is the regression test for the actual vulnerability that
  // was fixed — before it, this header was trusted verbatim as the caller's
  // identity, so anyone could act as any user just by setting it. Unlike
  // Asserts 1/3/5, this does not depend on the tsx/server-only fail-closed
  // path: lib/auth.ts's resolution chain (Bearer token, x-stack-auth header,
  // cookie session) simply never reads this header at all — confirmed
  // statically in Assert 6 below — so this holds regardless of environment.
  try {
    const req = new NextRequest('http://localhost:3000/api/users', {
      headers: { 'x-stack-user-id': 'victim-user-id' },
    });
    const resolvedId = await getAuthenticatedUserId(req);
    if (resolvedId === null) {
      console.log(`\n✅ PASS  Assert 4: forged x-stack-user-id header does not authenticate — getAuthenticatedUserId() → null (observed: ${JSON.stringify(resolvedId)})`);
    } else {
      pass = false;
      console.log(`\n❌ FAIL  Assert 4: forged x-stack-user-id header resolved to a user id (expected null, observed ${JSON.stringify(resolvedId)}) — this is the forged-identity-header vulnerability`);
    }
  } catch (err: any) {
    pass = false;
    console.log(`\n❌ FAIL  Assert 4: getAuthenticatedUserId threw instead of returning null — ${err?.message ?? err}`);
  }

  // Assert 5: the forged header buys an attacker nothing on the real
  // endpoint either — POST /api/users with a forged x-stack-user-id header
  // AND a matching victim id/username in the body must still be 401.
  try {
    const req = new NextRequest('http://localhost:3000/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stack-user-id': 'victim-user-id' },
      body: JSON.stringify({ id: 'victim-user-id', username: 'stolen' }),
    });
    const res = await POST(req);
    if (res.status === 401) {
      console.log(`✅ PASS  Assert 5: POST with forged x-stack-user-id header + matching victim id/username in body → still 401 (observed: ${res.status})`);
    } else if (res.status === 500) {
      pass = false;
      console.log(`❌ FAIL  Assert 5: expected 401, observed 500 — the forged header may be reaching the database`);
    } else {
      pass = false;
      console.log(`❌ FAIL  Assert 5: expected 401, observed ${res.status}`);
    }
  } catch (err: any) {
    pass = false;
    console.log(`❌ FAIL  Assert 5: POST with forged header threw instead of returning a response — ${err?.message ?? err}`);
  }

  // Assert 6 (static): lib/auth.ts must not reference x-stack-user-id at
  // all — not "reads it but ignores the value", but never looks at it as an
  // identity source. Informationally (not a failure), also report any
  // client file that still SENDS that header — those sends are now inert
  // since the server ignores them, but they're worth cleaning up.
  try {
    const authSrc = readFileSync(resolve(process.cwd(), 'lib/auth.ts'), 'utf8');
    if (!authSrc.includes('x-stack-user-id')) {
      console.log(`✅ PASS  Assert 6: lib/auth.ts does not reference x-stack-user-id anywhere (static check)`);
    } else {
      pass = false;
      console.log(`❌ FAIL  Assert 6: lib/auth.ts still references x-stack-user-id — the forgeable header fallback may not be fully removed`);
    }

    const stillSending = ['app', 'lib', 'components']
      .flatMap((dir) => findFilesContaining(resolve(process.cwd(), dir), 'x-stack-user-id'))
      .map((f) => relative(process.cwd(), f))
      .sort();
    if (stillSending.length > 0) {
      console.log(`ℹ️  ${stillSending.length} file(s) still send an x-stack-user-id header (now inert — the server ignores it; informational only, not a failure):`);
      for (const f of stillSending) console.log(`     - ${f}`);
    } else {
      console.log('ℹ️  No file under app/, lib/, or components/ sends an x-stack-user-id header.');
    }
  } catch (err: any) {
    pass = false;
    console.log(`❌ FAIL  Assert 6: could not read lib/auth.ts to check — ${err?.message ?? err}`);
  }

  console.log('\n📝 Documented gap: a cross-user 403 (authenticated as user A, POSTing user B\'s id) cannot');
  console.log('   be asserted here without a real Stack Auth session. Not faked — left as a manual/e2e check.');

  return pass;
}

async function runPartB(): Promise<boolean> {
  heading('Part B — database consistency');

  if (!process.env.POSTGRES_URL) {
    console.log('⏭  Skipped: POSTGRES_URL is not set. Part B needs a real database to check.');
    console.log('   Set POSTGRES_URL in .env.local and re-run to check for duplicate identities.');
    return true;
  }

  const { sql } = await import('@vercel/postgres');
  let pass = true;

  // Check 1a — same (normalized) email held by more than one live row.
  console.log('Check 1 — one human, one row:');
  const emailDupes = await sql`
    SELECT LOWER(TRIM(email)) AS email_norm, array_agg(id) AS ids, array_agg(username) AS usernames
    FROM users
    WHERE merged_into IS NULL AND email IS NOT NULL
    GROUP BY LOWER(TRIM(email))
    HAVING COUNT(*) > 1
  `;
  if (emailDupes.rows.length === 0) {
    console.log('  ✅ No live rows share the same email.');
  } else {
    pass = false;
    console.log(`  ❌ ${emailDupes.rows.length} email(s) held by more than one live row:`);
    for (const row of emailDupes.rows) {
      console.log(`     - ${row.email_norm}: ${JSON.stringify(row.ids)} (${JSON.stringify(row.usernames)})`);
    }
    console.log('     → Run: npx tsx scripts/merge-duplicate-users.ts');
  }

  // Check 1b — an email appears as an auth_methods identifier on one row
  // and as users.email on a *different* row: same human, split in two.
  const authMethodDupes = await sql`
    SELECT
      u1.id AS row_with_identifier,
      u1.username AS row_with_identifier_username,
      LOWER(TRIM(am.value ->> 'identifier')) AS identifier_email,
      u2.id AS row_with_matching_email,
      u2.username AS row_with_matching_email_username
    FROM users u1
    CROSS JOIN LATERAL jsonb_array_elements(u1.auth_methods) AS am(value)
    JOIN users u2
      ON LOWER(TRIM(u2.email)) = LOWER(TRIM(am.value ->> 'identifier'))
     AND u2.id <> u1.id
    WHERE u1.merged_into IS NULL
      AND u2.merged_into IS NULL
      AND am.value ->> 'identifier' IS NOT NULL
      AND am.value ->> 'identifier' <> ''
  `;
  if (authMethodDupes.rows.length === 0) {
    console.log('  ✅ No auth_methods identifier on one row matches users.email on a different row.');
  } else {
    pass = false;
    console.log(`  ❌ ${authMethodDupes.rows.length} auth_methods identifier(s) matching a different row's email:`);
    for (const row of authMethodDupes.rows) {
      console.log(
        `     - ${row.identifier_email}: identifier on ${row.row_with_identifier} (${row.row_with_identifier_username}), ` +
        `email on ${row.row_with_matching_email} (${row.row_with_matching_email_username})`
      );
    }
    console.log('     → Run: npx tsx scripts/merge-duplicate-users.ts');
  }

  // Check 2 — email coverage.
  console.log('\nCheck 2 — email coverage:');
  const noEmail = await sql`SELECT COUNT(*)::int AS cnt FROM users WHERE merged_into IS NULL AND email IS NULL`;
  const noEmailCount = noEmail.rows[0].cnt as number;
  if (noEmailCount === 0) {
    console.log('  ✅ Every live row has an email.');
  } else {
    console.log(`  ℹ️  ${noEmailCount} live row(s) have no email. Run: npx tsx scripts/backfill-user-emails.ts`);
  }

  // Check 3 — tombstone integrity.
  console.log('\nCheck 3 — tombstone integrity:');
  const danglingTombstones = await sql`
    SELECT t.id, t.merged_into
    FROM users t
    WHERE t.merged_into IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.merged_into)
  `;
  if (danglingTombstones.rows.length === 0) {
    console.log('  ✅ Every merged_into value references an existing row.');
  } else {
    pass = false;
    console.log(`  ❌ ${danglingTombstones.rows.length} row(s) have merged_into pointing at a non-existent row:`);
    for (const row of danglingTombstones.rows) {
      console.log(`     - ${row.id} → ${row.merged_into} (missing)`);
    }
  }

  const tombstonesWithEmail = await sql`
    SELECT id, email FROM users WHERE merged_into IS NOT NULL AND email IS NOT NULL
  `;
  if (tombstonesWithEmail.rows.length === 0) {
    console.log('  ✅ No tombstoned row still holds a non-null email.');
  } else {
    pass = false;
    console.log(`  ❌ ${tombstonesWithEmail.rows.length} tombstoned row(s) still hold a non-null email:`);
    for (const row of tombstonesWithEmail.rows) {
      console.log(`     - ${row.id}: ${row.email}`);
    }
  }

  const referencingTables: Array<{ table: string; query: () => Promise<{ rows: any[] }> }> = [
    { table: 'bets', query: () => sql`SELECT DISTINCT b.user_id FROM bets b JOIN users u ON b.user_id = u.id WHERE u.merged_into IS NOT NULL` },
    { table: 'comments', query: () => sql`SELECT DISTINCT c.user_id FROM comments c JOIN users u ON c.user_id = u.id WHERE u.merged_into IS NOT NULL` },
    { table: 'group_members', query: () => sql`SELECT DISTINCT gm.user_id FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE u.merged_into IS NOT NULL` },
    { table: 'wallets', query: () => sql`SELECT DISTINCT w.user_id FROM wallets w JOIN users u ON w.user_id = u.id WHERE u.merged_into IS NOT NULL` },
    { table: 'transactions', query: () => sql`SELECT DISTINCT tr.user_id FROM transactions tr JOIN users u ON tr.user_id = u.id WHERE u.merged_into IS NOT NULL` },
  ];
  let anyDanglingRefs = false;
  for (const { table, query } of referencingTables) {
    const result = await query();
    if (result.rows.length > 0) {
      anyDanglingRefs = true;
      pass = false;
      console.log(`  ❌ ${result.rows.length} tombstoned user id(s) still referenced by ${table}: ${result.rows.map((r) => r.user_id).join(', ')}`);
    }
  }
  if (!anyDanglingRefs) {
    console.log('  ✅ No tombstoned row is referenced by bets, comments, group_members, wallets, or transactions.');
  }

  // Check 4 — auth-method visibility (positive evidence, not a failure mode).
  console.log('\nCheck 4 — auth-method visibility (rows with more than one sign-in method):');
  const allLive = await sql`SELECT id, username, email, auth_methods FROM users WHERE merged_into IS NULL`;
  let multiMethodCount = 0;
  for (const row of allLive.rows) {
    const methods: Array<{ provider: string }> = Array.isArray(row.auth_methods) ? row.auth_methods : [];
    const providers = Array.from(new Set(methods.map((m) => m.provider)));
    if (providers.length > 1) {
      multiMethodCount++;
      console.log(`  ✅ ${row.id} (${row.username}, ${row.email ?? 'no email'}): ${providers.join(', ')}`);
    }
  }
  if (multiMethodCount === 0) {
    console.log('  ℹ️  No live row currently has more than one distinct auth_methods provider.');
  }

  return pass;
}

async function main() {
  const partAOk = await runPartA();
  // Part A failing always fails the whole run, regardless of Part B.
  const partBOk = await runPartB();
  overallOk = partAOk && partBOk;

  heading('Result');
  console.log(`Part A: ${partAOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Part B: ${partBOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(overallOk ? '\n🎉 All checks passed.' : '\n💥 One or more checks failed — see above.');

  process.exit(overallOk ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ check-identity failed to run:', err?.message ?? err);
  process.exit(1);
});
