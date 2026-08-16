// Merges duplicate `users` rows that represent the same human.
//
// Legacy data can have the same person signed up twice — once with
// email/password, once with Google — producing two `users` rows. The unique
// index on LOWER(email) (idx_users_email_lower) guarantees two *live* rows
// can never share a non-null `email` today, so duplicates show up as one row
// holding the email in its `email` column and the other holding it only
// inside `auth_methods` (identifier). This script finds those pairs/groups by
// unioning on every candidate email address, picks one canonical row per
// group, re-points every foreign-key reference onto the canonical row,
// tombstones the loser(s) (merged_into + email cleared), and deletes them.
//
// Usage:
//   npx tsx scripts/merge-duplicate-users.ts                                 # dry run (default)
//   npx tsx scripts/merge-duplicate-users.ts --dry-run                       # same, explicit
//   npx tsx scripts/merge-duplicate-users.ts --apply                         # execute
//   npx tsx scripts/merge-duplicate-users.ts --apply --email a@b.com         # limit to one group
//   npx tsx scripts/merge-duplicate-users.ts --apply --keep-tombstones       # don't delete losers
//   npx tsx scripts/merge-duplicate-users.ts --help
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

loadEnv({ path: resolve(process.cwd(), '.env.local') });

import { sql, db as pgPool, type VercelPoolClient } from '@vercel/postgres';

const HELP_TEXT = `
Merge duplicate user accounts (same human, multiple auth methods that never
got linked into one row) onto a single canonical row, then delete the
loser(s).

Usage:
  npx tsx scripts/merge-duplicate-users.ts                       Dry run (default) — prints the plan, writes nothing
  npx tsx scripts/merge-duplicate-users.ts --dry-run              Same as above, explicit
  npx tsx scripts/merge-duplicate-users.ts --apply                Execute the merge
  npx tsx scripts/merge-duplicate-users.ts --apply --email <addr> Limit to the duplicate group containing this email
  npx tsx scripts/merge-duplicate-users.ts --apply --keep-tombstones
                                                                    Keep loser rows (merged_into set, email cleared)
                                                                    instead of deleting them. Note: if the canonical
                                                                    row adopted the loser's username, the kept
                                                                    tombstone row's own username is set to its id
                                                                    (freeing the name) — expect a UUID-looking
                                                                    username on tombstones in that case.
  npx tsx scripts/merge-duplicate-users.ts --help                 Show this help

If both --dry-run and --apply are passed, --dry-run wins (safest default).

Requires POSTGRES_URL in the environment (.env.local).
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthMethodRow {
  provider: string;
  identifier?: string | null;
  linked_at?: string;
}

interface UserRow {
  id: string;
  username: string;
  username_selected: boolean;
  net_total: string;
  total_bet: string;
  streak: number;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  auth_methods: AuthMethodRow[];
  merged_into: string | null;
  created_at: string;
  last_seen_at: string | null;
}

interface IdentityGroup {
  rows: UserRow[];
  emails: Set<string>;
}

// Every table (besides `users` itself) that has a column referencing
// users(id), used both for the dry-run "rows that would move" report and for
// the post-merge zero-references verification. Table/column names are always
// drawn from this fixed list (never from user input), so building SQL text
// with them via simple interpolation is safe.
const REPORT_TABLES: Array<{ table: string; column: string }> = [
  { table: 'bets', column: 'user_id' },
  { table: 'comments', column: 'user_id' },
  { table: 'comment_reactions', column: 'user_id' },
  { table: 'comment_mentions', column: 'mentioned_user_id' },
  { table: 'activities', column: 'user_id' },
  { table: 'group_members', column: 'user_id' },
  { table: 'groups', column: 'created_by' },
  { table: 'groups', column: 'resolver_user_id' },
  { table: 'events', column: 'subject_user_id' },
  { table: 'escrow_holds', column: 'user_id' },
  { table: 'push_subscriptions', column: 'user_id' },
  { table: 'notification_preferences', column: 'user_id' },
  { table: 'event_notification_mutes', column: 'user_id' },
  { table: 'wallets', column: 'user_id' },
  { table: 'transactions', column: 'user_id' },
  { table: 'users', column: 'merged_into' },
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Cli {
  help: boolean;
  apply: boolean;
  email: string | null;
  keepTombstones: boolean;
}

function parseArgs(argv: string[]): Cli {
  const args = [...argv];
  const help = args.includes('--help') || args.includes('-h');
  const dryRun = args.includes('--dry-run');
  const applyFlag = args.includes('--apply');
  const keepTombstones = args.includes('--keep-tombstones');

  let email: string | null = null;
  const emailIdx = args.indexOf('--email');
  if (emailIdx !== -1) {
    const value = args[emailIdx + 1];
    if (!value || value.startsWith('--')) {
      console.error('❌ --email requires a value, e.g. --email someone@example.com');
      process.exit(1);
    }
    email = value;
  }

  const known = new Set(['--help', '-h', '--dry-run', '--apply', '--keep-tombstones', '--email', email ?? '']);
  const unknown = args.filter((a) => a.startsWith('--') && !known.has(a));
  if (unknown.length > 0) {
    console.error(`❌ Unknown option(s): ${unknown.join(', ')}`);
    console.error('   Run with --help for usage.');
    process.exit(1);
  }

  // --dry-run wins if both are passed.
  const apply = applyFlag && !dryRun;

  return { help, apply, email, keepTombstones };
}

// ---------------------------------------------------------------------------
// Identity grouping (union-find over shared candidate emails)
// ---------------------------------------------------------------------------

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root) as string;
    }
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function parseAuthMethodsLocal(value: unknown): AuthMethodRow[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value as AuthMethodRow[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapUserRow(row: any): UserRow {
  return {
    id: row.id,
    username: row.username,
    username_selected: row.username_selected === true,
    net_total: row.net_total ?? '0',
    total_bet: row.total_bet ?? '0',
    streak: row.streak ?? 0,
    email: row.email ?? null,
    display_name: row.display_name ?? null,
    avatar_url: row.avatar_url ?? null,
    auth_methods: parseAuthMethodsLocal(row.auth_methods),
    merged_into: row.merged_into ?? null,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at ?? null,
  };
}

// Every email-shaped identifier this row could be found under: its own
// `email` column, plus any auth_methods[].identifier that looks like an
// email address. Lowercased/trimmed for comparison.
function candidateEmails(row: UserRow): string[] {
  const emails = new Set<string>();
  if (row.email) {
    const e = row.email.trim().toLowerCase();
    if (e) emails.add(e);
  }
  for (const am of row.auth_methods) {
    const id = am?.identifier;
    if (typeof id === 'string') {
      const trimmed = id.trim();
      if (EMAIL_RE.test(trimmed)) emails.add(trimmed.toLowerCase());
    }
  }
  return Array.from(emails);
}

function buildGroups(rows: UserRow[]): IdentityGroup[] {
  const uf = new UnionFind();
  const emailsByRow = new Map<string, string[]>();
  const firstRowForEmail = new Map<string, string>();

  for (const row of rows) {
    uf.find(row.id);
    const emails = candidateEmails(row);
    emailsByRow.set(row.id, emails);
    for (const email of emails) {
      const existing = firstRowForEmail.get(email);
      if (existing) uf.union(row.id, existing);
      else firstRowForEmail.set(email, row.id);
    }
  }

  const clusters = new Map<string, UserRow[]>();
  for (const row of rows) {
    const emails = emailsByRow.get(row.id) ?? [];
    if (emails.length === 0) continue; // cannot be safely matched
    const root = uf.find(row.id);
    const list = clusters.get(root) ?? [];
    list.push(row);
    clusters.set(root, list);
  }

  const groups: IdentityGroup[] = [];
  for (const groupRows of Array.from(clusters.values())) {
    if (groupRows.length < 2) continue;
    const emails = new Set<string>();
    for (const row of groupRows) {
      for (const e of emailsByRow.get(row.id) ?? []) emails.add(e);
    }
    groups.push({ rows: groupRows, emails });
  }

  groups.sort((a, b) => {
    const aMin = a.rows.reduce((m, r) => (r.id < m ? r.id : m), a.rows[0].id);
    const bMin = b.rows.reduce((m, r) => (r.id < m ? r.id : m), b.rows[0].id);
    return aMin < bMin ? -1 : aMin > bMin ? 1 : 0;
  });

  return groups;
}

// Ordering, first match wins: (1) username_selected=TRUE, oldest created_at
// first, (2) otherwise oldest created_at first, (3) tie-break on id
// ascending. Rows with merged_into set are filtered out before this is
// called, so they can never be picked as canonical.
function pickCanonical(rows: UserRow[]): { canonical: UserRow; losers: UserRow[]; reason: string } {
  const sorted = [...rows].sort((a, b) => {
    const aSel = a.username_selected ? 1 : 0;
    const bSel = b.username_selected ? 1 : 0;
    if (aSel !== bSel) return bSel - aSel;
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const canonical = sorted[0];
  const losers = sorted.slice(1).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const reason = canonical.username_selected
    ? 'username_selected=true, oldest such row'
    : 'no row had username_selected=true — oldest created_at';

  return { canonical, losers, reason };
}

function dedupeAuthMethods(a: AuthMethodRow[], b: AuthMethodRow[]): AuthMethodRow[] {
  const seen = new Map<string, AuthMethodRow>();
  for (const am of [...a, ...b]) {
    if (!am || !am.provider) continue;
    const key = `${am.provider}::${(am.identifier ?? '').toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, am);
  }
  return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// Reporting (read-only, used by both dry run and the apply-mode plan preview)
// ---------------------------------------------------------------------------

async function countRows(table: string, column: string, userId: string): Promise<number> {
  const res = await sql.query(`SELECT COUNT(*)::int AS c FROM ${table} WHERE ${column} = $1`, [userId]);
  return res.rows[0]?.c ?? 0;
}

async function walletCurrencyConflict(canonicalId: string, loserId: string): Promise<string | null> {
  const [c, l] = await Promise.all([
    sql`SELECT currency FROM wallets WHERE user_id = ${canonicalId}`,
    sql`SELECT currency FROM wallets WHERE user_id = ${loserId}`,
  ]);
  if (c.rows.length === 0 || l.rows.length === 0) return null;
  const cCurrency = c.rows[0].currency;
  const lCurrency = l.rows[0].currency;
  if (cCurrency !== lCurrency) {
    return `canonical=${cCurrency} loser=${lCurrency}`;
  }
  return null;
}

async function printPlan(groups: IdentityGroup[]): Promise<{ totalLosers: number; totalRows: number }> {
  let totalLosers = 0;
  let totalRows = 0;

  for (let idx = 0; idx < groups.length; idx++) {
    const group = groups[idx];
    const { canonical, losers, reason } = pickCanonical(group.rows);

    console.log('');
    console.log(`Group ${idx + 1}/${groups.length} — emails: ${Array.from(group.emails).sort().join(', ')}`);
    console.log(`  ✅ canonical: id=${canonical.id} username=${canonical.username} created_at=${canonical.created_at} (${reason})`);

    for (const loser of losers) {
      totalLosers++;
      console.log(`  ➜ loser: id=${loser.id} username=${loser.username} created_at=${loser.created_at} email=${loser.email ?? '(none)'} -> ${canonical.id}`);

      let groupRowCount = 0;
      for (const t of REPORT_TABLES) {
        const c = await countRows(t.table, t.column, loser.id);
        if (c > 0) {
          console.log(`      ${t.table}.${t.column}: ${c} row(s) would move`);
          groupRowCount += c;
        }
      }
      totalRows += groupRowCount;

      const conflict = await walletCurrencyConflict(canonical.id, loser.id);
      if (conflict) {
        console.log(`      ⚠️  WALLET CURRENCY MISMATCH (${conflict}) — this group would ABORT under --apply`);
      }
    }
  }

  return { totalLosers, totalRows };
}

// ---------------------------------------------------------------------------
// Apply-mode merge logic
// ---------------------------------------------------------------------------

async function mergeGroupMembers(client: VercelPoolClient, canonicalId: string, loserId: string): Promise<void> {
  // Upgrade the canonical membership when the loser's is stronger, for
  // groups where both are already members: role 'admin' beats 'member',
  // status 'active' beats 'pending', keep the earliest joined_at.
  await client.query(
    `UPDATE group_members gc
       SET role = CASE WHEN gl.role = 'admin' THEN 'admin' ELSE gc.role END,
           status = CASE WHEN gl.status = 'active' THEN 'active' ELSE gc.status END,
           joined_at = LEAST(gc.joined_at, gl.joined_at)
       FROM group_members gl
       WHERE gc.user_id = $1 AND gl.user_id = $2 AND gc.group_id = gl.group_id`,
    [canonicalId, loserId]
  );
  // Move memberships the canonical row doesn't already have.
  await client.query(
    `UPDATE group_members gm SET user_id = $1
       WHERE gm.user_id = $2
         AND NOT EXISTS (SELECT 1 FROM group_members x WHERE x.group_id = gm.group_id AND x.user_id = $1)`,
    [canonicalId, loserId]
  );
  // Delete whatever's left (groups where the canonical already had a row).
  await client.query(`DELETE FROM group_members WHERE user_id = $1`, [loserId]);
}

// Generic "move if not already taken, else drop the leftover" merge for the
// remaining UNIQUE-constrained tables (comment_reactions, comment_mentions,
// event_notification_mutes).
async function mergeUniqueTable(
  client: VercelPoolClient,
  table: string,
  userColumn: string,
  otherKeyColumns: string[],
  canonicalId: string,
  loserId: string
): Promise<void> {
  const matchConds = otherKeyColumns.map((c) => `x.${c} = t.${c}`).join(' AND ');
  await client.query(
    `UPDATE ${table} t SET ${userColumn} = $1
       WHERE t.${userColumn} = $2
         AND NOT EXISTS (SELECT 1 FROM ${table} x WHERE x.${userColumn} = $1 AND ${matchConds})`,
    [canonicalId, loserId]
  );
  await client.query(`DELETE FROM ${table} WHERE ${userColumn} = $1`, [loserId]);
}

async function mergeNotificationPreferences(client: VercelPoolClient, canonicalId: string, loserId: string): Promise<string> {
  const lRes = await client.query(`SELECT 1 FROM notification_preferences WHERE user_id = $1`, [loserId]);
  if (lRes.rows.length === 0) return 'none';

  const cRes = await client.query(`SELECT 1 FROM notification_preferences WHERE user_id = $1`, [canonicalId]);
  if (cRes.rows.length === 0) {
    await client.query(`UPDATE notification_preferences SET user_id = $1 WHERE user_id = $2`, [canonicalId, loserId]);
    return 'moved loser onto canonical (canonical had none)';
  }

  await client.query(`DELETE FROM notification_preferences WHERE user_id = $1`, [loserId]);
  return 'kept canonical, dropped loser';
}

async function mergeWallets(client: VercelPoolClient, canonicalId: string, loserId: string): Promise<void> {
  const lRes = await client.query(`SELECT balance, currency FROM wallets WHERE user_id = $1`, [loserId]);
  if (lRes.rows.length === 0) return;

  const cRes = await client.query(`SELECT balance, currency FROM wallets WHERE user_id = $1`, [canonicalId]);
  if (cRes.rows.length === 0) {
    await client.query(`UPDATE wallets SET user_id = $1 WHERE user_id = $2`, [canonicalId, loserId]);
    return;
  }

  const cWallet = cRes.rows[0];
  const lWallet = lRes.rows[0];
  if (cWallet.currency !== lWallet.currency) {
    throw new Error(
      `wallet currency mismatch: canonical ${canonicalId} is ${cWallet.currency}, loser ${loserId} is ${lWallet.currency} — refusing to merge money across currencies`
    );
  }

  await client.query(
    `UPDATE wallets SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
    [parseFloat(lWallet.balance), canonicalId]
  );
  await client.query(`DELETE FROM wallets WHERE user_id = $1`, [loserId]);
}

async function verifyZeroReferences(client: VercelPoolClient, loserId: string): Promise<string[]> {
  const offending: string[] = [];
  for (const t of REPORT_TABLES) {
    const res = await client.query(`SELECT COUNT(*)::int AS c FROM ${t.table} WHERE ${t.column} = $1`, [loserId]);
    const count = res.rows[0]?.c ?? 0;
    if (count > 0) offending.push(`${t.table}.${t.column}=${count}`);
  }
  return offending;
}

async function mergeOneLoser(client: VercelPoolClient, canonicalId: string, loserId: string, keepTombstones: boolean): Promise<void> {
  const cRes = await client.sql`SELECT * FROM users WHERE id = ${canonicalId} FOR UPDATE`;
  const lRes = await client.sql`SELECT * FROM users WHERE id = ${loserId} FOR UPDATE`;
  if (cRes.rows.length === 0) throw new Error(`canonical user ${canonicalId} not found`);
  if (lRes.rows.length === 0) {
    console.log(`    ⏭  loser ${loserId} already gone (idempotent re-run), skipping`);
    return;
  }
  const C = mapUserRow(cRes.rows[0]);
  const L = mapUserRow(lRes.rows[0]);

  console.log(`    → merging loser ${L.id} (${L.username}) into canonical ${C.id} (${C.username})`);

  // Decide the FINAL username up front, before any denormalized username
  // columns get written: the canonical row adopts the loser's username when
  // the canonical never had a user-picked username but the loser did (and
  // nobody else already holds it). bets/comments/activities.username below
  // must be stamped with this final value, not C's current (possibly
  // about-to-be-replaced) username, or those rows end up stale — including
  // the loser's own historical rows, which already carried the right name.
  let usernameSwap = false;
  if (!C.username_selected && L.username_selected) {
    const holder = await client.sql`SELECT id FROM users WHERE LOWER(username) = LOWER(${L.username}) AND id != ${L.id}`;
    if (holder.rows.length === 0) usernameSwap = true;
  }
  const finalUsername = usernameSwap ? L.username : C.username;

  // 1. Simple re-points (no unique constraint in the way).
  await client.sql`UPDATE bets SET user_id = ${C.id}, username = ${finalUsername} WHERE user_id = ${L.id}`;
  await client.sql`UPDATE comments SET user_id = ${C.id}, username = ${finalUsername} WHERE user_id = ${L.id}`;
  await client.sql`UPDATE activities SET user_id = ${C.id}, username = ${finalUsername} WHERE user_id = ${L.id}`;
  await client.sql`UPDATE escrow_holds SET user_id = ${C.id} WHERE user_id = ${L.id}`;
  await client.sql`UPDATE transactions SET user_id = ${C.id} WHERE user_id = ${L.id}`;
  await client.sql`UPDATE push_subscriptions SET user_id = ${C.id} WHERE user_id = ${L.id}`;
  await client.sql`UPDATE groups SET created_by = ${C.id} WHERE created_by = ${L.id}`;
  await client.sql`UPDATE groups SET resolver_user_id = ${C.id} WHERE resolver_user_id = ${L.id}`;
  await client.sql`UPDATE events SET subject_user_id = ${C.id} WHERE subject_user_id = ${L.id}`;
  await client.sql`UPDATE users SET merged_into = ${C.id} WHERE merged_into = ${L.id}`;

  // 2. Conflict-handled re-points.
  await mergeGroupMembers(client, C.id, L.id);
  await mergeUniqueTable(client, 'comment_reactions', 'user_id', ['comment_id', 'emoji'], C.id, L.id);
  await mergeUniqueTable(client, 'comment_mentions', 'mentioned_user_id', ['comment_id'], C.id, L.id);
  await mergeUniqueTable(client, 'event_notification_mutes', 'user_id', ['event_id'], C.id, L.id);

  // 3. notification_preferences (PK user_id).
  const npOutcome = await mergeNotificationPreferences(client, C.id, L.id);
  if (npOutcome !== 'none') console.log(`      notification_preferences: ${npOutcome}`);

  // 4. wallets (PK user_id, balances summed, currency mismatch aborts the group).
  await mergeWallets(client, C.id, L.id);

  // 5/6. Free up the loser's username (if it's about to be claimed) and null
  // its email *before* writing onto the canonical row, or the unique indexes
  // on username/LOWER(email) would block the write while both rows are live.
  // (usernameSwap/finalUsername were already decided above, before step 1.)
  if (usernameSwap) {
    // Renamed to the loser's own id purely to free the username slot — if
    // --keep-tombstones is set, this row survives with its id as its
    // username; that's expected, it's a dead tombstone either way.
    await client.sql`UPDATE users SET username = ${L.id} WHERE id = ${L.id}`;
    console.log(`      username: canonical adopts "${L.username}" (loser had username_selected=true, canonical did not)`);
  }
  await client.sql`UPDATE users SET merged_into = ${C.id}, email = NULL WHERE id = ${L.id}`;

  let emailFill: string | null = null;
  if (!C.email && L.email) {
    const holder = await client.sql`SELECT id FROM users WHERE LOWER(email) = LOWER(${L.email}) AND id != ${C.id}`;
    if (holder.rows.length === 0) {
      emailFill = L.email;
    } else {
      console.log(`      ⚠️  email ${L.email} already claimed by a third row — not filling onto canonical`);
    }
  }

  const mergedAuthMethods = dedupeAuthMethods(C.auth_methods, L.auth_methods);

  await client.sql`
    UPDATE users SET
      net_total = net_total + ${parseFloat(L.net_total)},
      total_bet = total_bet + ${parseFloat(L.total_bet)},
      streak = GREATEST(streak, ${L.streak}),
      auth_methods = ${JSON.stringify(mergedAuthMethods)}::jsonb,
      email = COALESCE(email, ${emailFill}),
      display_name = COALESCE(display_name, ${L.display_name}),
      avatar_url = COALESCE(avatar_url, ${L.avatar_url}),
      last_seen_at = GREATEST(last_seen_at, ${L.last_seen_at}),
      username = COALESCE(${usernameSwap ? L.username : null}, username),
      username_selected = username_selected OR ${usernameSwap}
    WHERE id = ${C.id}
  `;

  // 7. Re-verify before COMMIT.
  const offending = await verifyZeroReferences(client, L.id);
  if (offending.length > 0) {
    throw new Error(`post-merge verification failed for loser ${L.id}: still referenced by ${offending.join(', ')}`);
  }

  if (keepTombstones) {
    console.log(`      ✅ tombstoned loser ${L.id} (kept — --keep-tombstones)`);
  } else {
    await client.sql`DELETE FROM users WHERE id = ${L.id}`;
    console.log(`      ✅ deleted loser ${L.id}`);
  }
}

async function applyGroup(group: IdentityGroup, keepTombstones: boolean): Promise<number> {
  const { canonical, losers } = pickCanonical(group.rows);

  const client = await pgPool.connect();
  try {
    await client.sql`BEGIN`;
    for (const loser of losers) {
      await mergeOneLoser(client, canonical.id, loser.id, keepTombstones);
    }
    await client.sql`COMMIT`;
  } catch (err) {
    await client.sql`ROLLBACK`;
    throw err;
  } finally {
    client.release();
  }

  return losers.length;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function fetchLiveGroups(emailFilter: string | null): Promise<IdentityGroup[]> {
  // Rows already tombstoned (merged_into IS NOT NULL) are excluded: they've
  // already been fully processed in a prior run (their FK references were
  // already moved), so re-including them would double count their own
  // net_total/total_bet/streak onto whatever they're pointed at. This also
  // keeps a repeated `--apply --keep-tombstones` run idempotent.
  const res = await sql`SELECT * FROM users WHERE merged_into IS NULL`;
  const rows = res.rows.map(mapUserRow);
  let groups = buildGroups(rows);

  if (emailFilter) {
    const target = emailFilter.trim().toLowerCase();
    groups = groups.filter((g) => g.emails.has(target));
  }

  return groups;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  if (cli.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (!process.env.POSTGRES_URL) {
    console.error('❌ No database configured: POSTGRES_URL is not set.');
    console.error('   Add it to .env.local (see other scripts/*.ts for the expected shape) and try again.');
    process.exit(1);
  }

  console.log(
    cli.apply
      ? '🚀 Merging duplicate users (APPLY — writes will be made)...'
      : '🔍 Merging duplicate users (DRY RUN — pass --apply to write changes)...'
  );
  if (cli.email) console.log(`   limited to duplicate group containing: ${cli.email}`);
  if (cli.keepTombstones) console.log('   --keep-tombstones: loser rows will be kept (tombstoned), not deleted');

  const groups = await fetchLiveGroups(cli.email);

  if (groups.length === 0) {
    console.log(cli.email ? `\n✅ No duplicate group found containing ${cli.email}. Nothing to do.` : '\n✅ No duplicate identity groups found. Nothing to do.');
    process.exit(0);
  }

  const { totalLosers, totalRows } = await printPlan(groups);
  console.log('');
  console.log(`📊 Plan: ${groups.length} group(s), ${totalLosers} loser(s), ${totalRows} row(s) to reassign.`);

  if (!cli.apply) {
    console.log('\n(dry run — no changes made. Re-run with --apply to execute.)');
    process.exit(0);
  }

  console.log('\n🚀 Applying merges...');
  let mergedGroups = 0;
  let mergedLosers = 0;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    try {
      const n = await applyGroup(group, cli.keepTombstones);
      mergedGroups++;
      mergedLosers += n;
      console.log(`  ✅ group ${i + 1}/${groups.length} committed`);
    } catch (err: any) {
      console.error(`\n❌ Failed to merge group ${i + 1}/${groups.length} [${Array.from(group.emails).join(', ')}]: ${err?.message ?? err}`);
      console.error('   Transaction was rolled back — no partial changes were made for this group.');
      process.exit(1);
    }
  }

  console.log('\n🔎 Re-scanning for remaining duplicate groups...');
  const remaining = await fetchLiveGroups(cli.email);
  if (remaining.length > 0) {
    console.error(`❌ ${remaining.length} duplicate group(s) still remain after apply — something is wrong.`);
    process.exit(1);
  }

  console.log(`\n🎉 Done: merged ${mergedGroups} group(s), ${mergedLosers} loser row(s). Re-scan confirms 0 remaining duplicate groups.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ merge-duplicate-users failed:', err?.message ?? err);
  process.exit(1);
});
