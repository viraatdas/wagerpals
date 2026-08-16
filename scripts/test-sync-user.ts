// Integration test for lib/sync-user.ts — the single canonical path that turns
// an authenticated Stack Auth session into a `users` row. Web and mobile both
// funnel through it via POST /api/users.
//
// Usage:
//   npm run test:sync-user
//
// No database is required. `db.users` is swapped for an in-memory fake that
// mirrors the SQL in lib/db.ts statement-for-statement, including the
// constraints that actually bite in production:
//
//   users_pkey             PRIMARY KEY (id)
//   users_username_key     UNIQUE (username)                     -- case SENSITIVE
//   idx_users_email_lower  UNIQUE (LOWER(email)) WHERE email IS NOT NULL
//
// Running this file at all also proves lib/sync-user.ts stays loadable outside
// a Next.js server bundle — it must not pull in `server-only` (see the note at
// the top of lib/sync-user.ts).
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { db } from '@/lib/db';
import { syncUser, derivePlaceholderUsername, type SyncUserResult } from '@/lib/sync-user';
import type { AuthenticatedStackUser } from '@/lib/auth';
import type { AuthMethod, User } from '@/lib/types';

// ---------------------------------------------------------------------------
// In-memory mirror of the `users` table
// ---------------------------------------------------------------------------

/** The columns of `users` that lib/db.ts reads or writes. */
type UserRow = {
  id: string;
  username: string;
  username_selected: boolean;
  net_total: number;
  total_bet: number;
  streak: number;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  auth_methods: AuthMethod[];
  merged_into: string | null;
  last_seen_at: string | null;
};

const rows = new Map<string, UserRow>();

/** Statement log, so tests can assert how many round trips a path costs. */
let statements: string[] = [];

/** Fires immediately before a create's INSERT, to stage write races. */
let beforeCreate: (() => void) | null = null;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** A Postgres unique violation, shaped like the ones `pg` actually raises. */
function uniqueViolation(constraint: string): Error & { code: string; constraint: string } {
  const err = new Error(`duplicate key value violates unique constraint "${constraint}"`) as Error & {
    code: string;
    constraint: string;
  };
  err.code = '23505';
  err.constraint = constraint;
  return err;
}

/** Mirror of lib/db.ts's mapUser(), including its coercions. */
function mapRow(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    username_selected: row.username_selected || false,
    net_total: parseFloat(String(row.net_total)),
    total_bet: parseFloat(String(row.total_bet ?? 0)),
    streak: row.streak,
    email: row.email || undefined,
    display_name: row.display_name || undefined,
    avatar_url: row.avatar_url || undefined,
    auth_methods: clone(row.auth_methods ?? []),
    merged_into: row.merged_into ?? null,
    last_seen_at: row.last_seen_at || undefined,
  };
}

/** Enforces idx_users_email_lower (UNIQUE on LOWER(email), NULLs exempt). */
function assertEmailIndexFree(email: string | null, ownerId: string): void {
  if (!email) return;
  for (const row of Array.from(rows.values())) {
    if (row.id !== ownerId && row.email && row.email.toLowerCase() === email.toLowerCase()) {
      throw uniqueViolation('idx_users_email_lower');
    }
  }
}

const fakeUsers = {
  // SELECT * FROM users WHERE id = $1
  get: async (id: string): Promise<User | null> => {
    statements.push(`get:${id}`);
    const row = rows.get(id);
    return row ? mapRow(row) : null;
  },

  // SELECT * FROM users WHERE LOWER(username) = LOWER($1)
  getByUsername: async (username: string): Promise<User | null> => {
    statements.push(`getByUsername:${username}`);
    for (const row of Array.from(rows.values())) {
      if (row.username.toLowerCase() === String(username).toLowerCase()) return mapRow(row);
    }
    return null;
  },

  // SELECT * FROM users WHERE LOWER(email) = LOWER($1) — tombstones included.
  getByEmail: async (email: string): Promise<User | null> => {
    statements.push(`getByEmail:${email}`);
    for (const row of Array.from(rows.values())) {
      if (row.email && row.email.toLowerCase() === String(email).toLowerCase()) return mapRow(row);
    }
    return null;
  },

  // SELECT * FROM users WHERE merged_into IS NULL ORDER BY ...
  getAll: async (): Promise<User[]> => {
    statements.push('getAll');
    return Array.from(rows.values())
      .filter(row => row.merged_into === null)
      .map(mapRow);
  },

  create: async (user: User): Promise<User> => {
    statements.push(`create:${user.id}`);
    beforeCreate?.();

    if (rows.has(user.id)) throw uniqueViolation('users_pkey');
    for (const row of Array.from(rows.values())) {
      if (row.username === user.username) throw uniqueViolation('users_username_key');
    }
    assertEmailIndexFree(user.email ?? null, user.id);

    rows.set(user.id, {
      id: user.id,
      username: user.username,
      // Mirrors the value lib/db.ts's INSERT writes for this column.
      username_selected: user.username_selected ?? false,
      net_total: user.net_total,
      total_bet: user.total_bet,
      streak: user.streak,
      email: user.email || null,
      display_name: user.display_name || null,
      avatar_url: user.avatar_url || null,
      auth_methods: clone(user.auth_methods || []),
      merged_into: null,
      last_seen_at: null,
    });
    return user;
  },

  // lib/db.ts issues one UPDATE per defined key, then re-reads the row.
  update: async (id: string, data: Partial<User>): Promise<User | null> => {
    statements.push(`update:${id}:${Object.keys(data).sort().join(',')}`);
    const row = rows.get(id);
    if (!row) return null;

    if (data.username !== undefined) row.username = data.username;
    if (data.net_total !== undefined) row.net_total = data.net_total;
    if (data.total_bet !== undefined) row.total_bet = data.total_bet;
    if (data.streak !== undefined) row.streak = data.streak;
    if (data.username_selected !== undefined) row.username_selected = data.username_selected;
    if (data.email !== undefined) {
      assertEmailIndexFree(data.email ?? null, id);
      row.email = data.email ?? null;
    }
    if (data.display_name !== undefined) row.display_name = data.display_name ?? null;
    if (data.avatar_url !== undefined) row.avatar_url = data.avatar_url ?? null;
    if (data.auth_methods !== undefined) row.auth_methods = clone(data.auth_methods);
    if (data.merged_into !== undefined) row.merged_into = data.merged_into ?? null;
    if (data.last_seen_at !== undefined) row.last_seen_at = data.last_seen_at ?? null;

    return mapRow(row);
  },
};

/** Insert a row directly, bypassing create()'s checks (test arrangement). */
function seed(row: Partial<UserRow> & { id: string; username: string }): UserRow {
  const full: UserRow = {
    username_selected: false,
    net_total: 0,
    total_bet: 0,
    streak: 0,
    email: null,
    display_name: null,
    avatar_url: null,
    auth_methods: [],
    merged_into: null,
    last_seen_at: null,
    ...row,
  };
  rows.set(full.id, full);
  return full;
}

const rawRow = (id: string): UserRow => {
  const row = rows.get(id);
  if (!row) throw new Error(`expected a row for ${id}`);
  return row;
};

// ---------------------------------------------------------------------------
// Stack Auth fixtures
// ---------------------------------------------------------------------------

function stackUser(overrides: Partial<AuthenticatedStackUser> & { id: string }): AuthenticatedStackUser {
  return {
    primaryEmail: null,
    primaryEmailVerified: false,
    displayName: null,
    profileImageUrl: null,
    hasPassword: false,
    otpAuthEnabled: false,
    passkeyAuthEnabled: false,
    oauthProviderIds: [],
    ...overrides,
  };
}

const UUID_A = '3f2b9c1e-0d4a-4f6b-8e21-5a7c9d0b1e33';
const UUID_B = '7a1c4e8d-2b6f-4a9c-9d13-0e5b8f2a6c47';

function expectOk(result: SyncUserResult, context: string): User {
  if (!result.ok) throw new Error(`${context}: expected ok, got ${result.status} "${result.error}"`);
  return result.user;
}

function expectErr(result: SyncUserResult, context: string): { status: number; error: string } {
  if (result.ok) throw new Error(`${context}: expected a failure, got ok (user ${result.user.id})`);
  return { status: result.status, error: result.error };
}

const providersOf = (user: User): string[] => (user.auth_methods ?? []).map(m => m.provider).sort();

// ---------------------------------------------------------------------------
// Tiny test runner
// ---------------------------------------------------------------------------

type Case = { name: string; fn: () => Promise<void> };
const cases: Case[] = [];
const test = (name: string, fn: () => Promise<void>) => cases.push({ name, fn });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n     expected: ${b}\n     actual:   ${a}`);
}

/** console.warn/error output captured for the current test. */
let logged: string[] = [];
const realWarn = console.warn;
const realError = console.error;

function beginTest() {
  rows.clear();
  statements = [];
  logged = [];
  beforeCreate = null;
  console.warn = (...args: unknown[]) => logged.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(' '));
}

function endTest() {
  console.warn = realWarn;
  console.error = realError;
}

// ===========================================================================
// New-account creation
// ===========================================================================

test('creates a row for a brand-new Google user with a verified email', async () => {
  const user = expectOk(
    await syncUser(
      stackUser({
        id: UUID_A,
        primaryEmail: 'Ada@Example.COM',
        primaryEmailVerified: true,
        displayName: 'Ada Lovelace',
        profileImageUrl: 'https://cdn.example.com/ada.png',
        oauthProviderIds: ['google'],
      })
    ),
    'new google user'
  );

  assertEqual(user.id, UUID_A, 'the row id must be the Stack Auth id');
  assertEqual(user.username, 'adalovelace', 'the username is sanitised and lower-cased from displayName');
  assertEqual(user.email, 'ada@example.com', 'a verified email is stored lower-cased');
  assertEqual(user.display_name, 'Ada Lovelace', 'display_name is carried over verbatim');
  assertEqual(user.avatar_url, 'https://cdn.example.com/ada.png', 'avatar_url is carried over');
  assertEqual(providersOf(user), ['google'], 'auth_methods records the google provider');
  assertEqual(user.auth_methods![0].identifier, 'ada@example.com', 'and keys it on the verified email');
  assert(user.auth_methods![0].linked_at, 'a new method is stamped with linked_at');
  assert(user.last_seen_at, 'last_seen_at is stamped on creation');
  assertEqual(user.net_total, 0, 'a new user starts at zero');
});

test('an email Stack Auth has not verified never lands on the row', async () => {
  const user = expectOk(
    await syncUser(
      stackUser({
        id: UUID_A,
        primaryEmail: 'unverified@example.com',
        primaryEmailVerified: false,
        displayName: 'Pending Pat',
        hasPassword: true,
      })
    ),
    'unverified signup'
  );

  assertEqual(user.email, undefined, 'an unverified email is never written');
  assertEqual(providersOf(user), ['password'], 'the password method is still recorded');
  assertEqual(user.auth_methods![0].identifier, null, 'without an identifier, since the email is untrusted');
});

test('username_selected is false for a derived name and true for a chosen one', async () => {
  const derived = expectOk(
    await syncUser(stackUser({ id: UUID_A, displayName: 'Derived Dana' })),
    'derived username'
  );
  assertEqual(derived.username_selected, false, 'a derived name must not look like a deliberate choice');
  assertEqual(
    rawRow(UUID_A).username_selected,
    false,
    'and the stored column must be false, not coerced to true by the INSERT'
  );

  const chosen = expectOk(
    await syncUser(stackUser({ id: UUID_B, displayName: 'Chosen Chris' }), {
      username: 'chris',
      usernameSelected: true,
    }),
    'chosen username'
  );
  assertEqual(chosen.username_selected, true, 'an explicit choice is recorded as selected');
});

test('falls back to the email local-part when there is no display name', async () => {
  const user = expectOk(
    await syncUser(
      stackUser({
        id: UUID_A,
        primaryEmail: 'grace.hopper@navy.mil',
        primaryEmailVerified: true,
        otpAuthEnabled: true,
      })
    ),
    'email-derived username'
  );
  assertEqual(user.username, 'gracehopper', 'the local-part is sanitised into a username');
});

test('falls back to an id-derived placeholder when the derived name is taken', async () => {
  seed({ id: 'someone-else', username: 'ada' });

  const user = expectOk(await syncUser(stackUser({ id: UUID_A, displayName: 'Ada' })), 'colliding username');

  assertEqual(user.username, derivePlaceholderUsername(UUID_A), 'a taken name falls back to the placeholder');
  assert(user.username.startsWith('user_'), 'the placeholder is recognisable');
  assert(user.username.length <= 20, 'the placeholder respects the 20-char username limit');
  assertEqual(rawRow('someone-else').username, 'ada', 'and the incumbent keeps their username');
});

test('placeholder usernames are deterministic and always valid', async () => {
  assertEqual(derivePlaceholderUsername(UUID_A), derivePlaceholderUsername(UUID_A), 'derivation is stable');
  assert(
    derivePlaceholderUsername(UUID_A) !== derivePlaceholderUsername(UUID_B),
    'distinct ids derive distinct placeholders'
  );
  for (const id of [UUID_A, UUID_B, 'x', '', '!!!']) {
    const name = derivePlaceholderUsername(id);
    assert(/^[a-zA-Z0-9_]{2,20}$/.test(name), `placeholder for "${id}" must be a valid username, got "${name}"`);
  }
});

test('a display name with no usable characters still produces a valid row', async () => {
  const user = expectOk(await syncUser(stackUser({ id: UUID_A, displayName: '🎲🎲🎲' })), 'emoji-only display name');
  assert(/^[a-z0-9_]{2,20}$/.test(user.username), `expected a valid username, got "${user.username}"`);
});

// ===========================================================================
// Re-sync of an existing account
// ===========================================================================

test('a plain re-sync never renames the user', async () => {
  seed({ id: UUID_A, username: 'ada', username_selected: true, email: 'ada@example.com' });

  // app/page.tsx posts { id, username } on every load without
  // username_selected — that must not overwrite a deliberate choice.
  const user = expectOk(
    await syncUser(
      stackUser({
        id: UUID_A,
        displayName: 'Ada Lovelace',
        primaryEmail: 'ada@example.com',
        primaryEmailVerified: true,
      }),
      { username: 'Ada Lovelace' }
    ),
    'plain re-sync'
  );

  assertEqual(user.username, 'ada', 'the stored username survives a sync-shaped POST');
  assertEqual(user.username_selected, true, 'and username_selected is not reset');
});

test('linking a second provider unions auth_methods instead of replacing them', async () => {
  const first = expectOk(
    await syncUser(
      stackUser({
        id: UUID_A,
        primaryEmail: 'ada@example.com',
        primaryEmailVerified: true,
        displayName: 'Ada',
        hasPassword: true,
      })
    ),
    'password signup'
  );
  assertEqual(providersOf(first), ['password'], 'starts with just the password method');
  const passwordLinkedAt = first.auth_methods![0].linked_at;

  const second = expectOk(
    await syncUser(
      stackUser({
        id: UUID_A,
        primaryEmail: 'ada@example.com',
        primaryEmailVerified: true,
        displayName: 'Ada',
        hasPassword: true,
        oauthProviderIds: ['google'],
      })
    ),
    'google linked afterwards'
  );

  assertEqual(providersOf(second), ['google', 'password'], 'both methods live on the one row');
  const password = second.auth_methods!.find(m => m.provider === 'password')!;
  assertEqual(password.linked_at, passwordLinkedAt, 'and the original keeps its earliest linked_at');
});

test('verifying an email upgrades the existing method instead of duplicating it', async () => {
  const before = expectOk(
    await syncUser(
      stackUser({
        id: UUID_A,
        primaryEmail: 'ada@example.com',
        primaryEmailVerified: false,
        displayName: 'Ada',
        hasPassword: true,
      })
    ),
    'unverified signup'
  );
  assertEqual(before.auth_methods!.length, 1, 'one method while unverified');
  assertEqual(before.auth_methods![0].identifier, null, 'recorded without an identifier');

  const after = expectOk(
    await syncUser(
      stackUser({
        id: UUID_A,
        primaryEmail: 'ada@example.com',
        primaryEmailVerified: true,
        displayName: 'Ada',
        hasPassword: true,
      })
    ),
    'after verification'
  );

  assertEqual(after.auth_methods!.length, 1, 'verification must not fork the password method into two entries');
  assertEqual(after.auth_methods![0].provider, 'password', 'still the password method');
  assertEqual(after.auth_methods![0].identifier, 'ada@example.com', 'now carrying the verified email');
  assertEqual(after.email, 'ada@example.com', 'and the email lands on the row');
});

test('re-syncing an unchanged user is idempotent', async () => {
  const stack = stackUser({
    id: UUID_A,
    primaryEmail: 'ada@example.com',
    primaryEmailVerified: true,
    displayName: 'Ada',
    oauthProviderIds: ['google'],
  });

  const first = expectOk(await syncUser(stack), 'first sync');
  const second = expectOk(await syncUser(stack), 'second sync');
  const third = expectOk(await syncUser(stack), 'third sync');

  assertEqual(second.auth_methods, first.auth_methods, 'auth_methods must not grow on re-sync');
  assertEqual(third.auth_methods, first.auth_methods, 'or on the sync after that');
  assertEqual(third.username, first.username, 'the username is stable');
  assertEqual(third.email, first.email, 'and so is the email');
});

test('display name and avatar changes propagate on re-sync', async () => {
  seed({ id: UUID_A, username: 'ada', display_name: 'Ada', avatar_url: 'https://cdn.example.com/old.png' });

  const user = expectOk(
    await syncUser(
      stackUser({ id: UUID_A, displayName: 'Ada L.', profileImageUrl: 'https://cdn.example.com/new.png' })
    ),
    'profile refresh'
  );

  assertEqual(user.display_name, 'Ada L.', 'display_name follows Stack Auth');
  assertEqual(user.avatar_url, 'https://cdn.example.com/new.png', 'avatar_url follows Stack Auth');
});

test('last_seen_at is bumped on every sync', async () => {
  seed({ id: UUID_A, username: 'ada', last_seen_at: '2020-01-01T00:00:00.000Z' });

  const user = expectOk(await syncUser(stackUser({ id: UUID_A })), 're-sync');

  assert(user.last_seen_at, 'last_seen_at is set');
  assert(
    Date.parse(user.last_seen_at!) > Date.parse('2020-01-01T00:00:00.000Z'),
    `last_seen_at must move forward, got ${user.last_seen_at}`
  );
});

test('a legacy row with no email picks one up once Stack Auth verifies it', async () => {
  seed({ id: UUID_A, username: 'ada', email: null });

  const user = expectOk(
    await syncUser(stackUser({ id: UUID_A, primaryEmail: '  Ada@Example.com  ', primaryEmailVerified: true })),
    'email backfill'
  );

  assertEqual(user.email, 'ada@example.com', 'the email is trimmed and lower-cased before it is stored');
});

// ===========================================================================
// Identity consolidation: one email, one row
// ===========================================================================

test('a second Stack account on the same verified email does not steal it', async () => {
  const first = expectOk(
    await syncUser(
      stackUser({
        id: UUID_A,
        primaryEmail: 'dupe@example.com',
        primaryEmailVerified: true,
        displayName: 'First',
        oauthProviderIds: ['google'],
      })
    ),
    'first account'
  );
  assertEqual(first.email, 'dupe@example.com', 'the first account owns the email');

  const second = expectOk(
    await syncUser(
      stackUser({
        id: UUID_B,
        primaryEmail: 'DUPE@example.com',
        primaryEmailVerified: true,
        displayName: 'Second',
        hasPassword: true,
      })
    ),
    'second account on the same email'
  );

  assertEqual(second.email, undefined, 'the second row is created without the contested email');
  assertEqual(rawRow(UUID_A).email, 'dupe@example.com', 'the incumbent keeps it — the UNIQUE index holds');
  assert(
    logged.some(line => line.includes('dupe@example.com') && line.includes(UUID_A) && line.includes(UUID_B)),
    `the collision must be logged with both row ids, got: ${JSON.stringify(logged)}`
  );
});

test('the duplicate-email warning names a command that actually exists', async () => {
  await syncUser(
    stackUser({ id: UUID_A, primaryEmail: 'dupe@example.com', primaryEmailVerified: true, displayName: 'First' })
  );
  logged = [];
  await syncUser(
    stackUser({ id: UUID_B, primaryEmail: 'dupe@example.com', primaryEmailVerified: true, displayName: 'Second' })
  );

  const warning = logged.find(line => line.includes('dupe@example.com'));
  assert(warning, `expected a conflict warning, got: ${JSON.stringify(logged)}`);

  // The warning tells an operator what to run. If that command is renamed or
  // deleted, this test fails rather than the operator discovering it at 2am.
  const scripts = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).scripts as Record<
    string,
    string
  >;
  const named = Object.keys(scripts).filter(name => warning!.includes(`npm run ${name}`));
  assert(
    named.length > 0,
    `the warning should point at an npm script that exists; none of [${Object.keys(scripts).join(', ')}] appear in: ${warning}`
  );
});

test('a row that already owns the email is not treated as a conflict', async () => {
  seed({ id: UUID_A, username: 'ada', email: 'ada@example.com' });

  const user = expectOk(
    await syncUser(stackUser({ id: UUID_A, primaryEmail: 'ada@example.com', primaryEmailVerified: true })),
    'self-owned email'
  );

  assertEqual(user.email, 'ada@example.com', 'the row keeps its own email');
  assertEqual(logged.length, 0, `no conflict should be logged, got: ${JSON.stringify(logged)}`);
});

// ===========================================================================
// Explicit username selection (UsernameModal / UsernameSetupScreen)
// ===========================================================================

test('an explicitly chosen username is normalised to lower case', async () => {
  seed({ id: UUID_A, username: 'user_placeholder' });

  const user = expectOk(
    await syncUser(stackUser({ id: UUID_A }), { username: '  AdaLovelace  ', usernameSelected: true }),
    'explicit choice'
  );

  assertEqual(user.username, 'adalovelace', 'stored lower-cased and trimmed');
  assertEqual(user.username_selected, true, 'and flagged as a deliberate choice');
});

test('claiming a username another user holds is rejected with a 400', async () => {
  seed({ id: 'incumbent', username: 'taken' });
  seed({ id: UUID_A, username: 'user_placeholder' });

  const failure = expectErr(
    await syncUser(stackUser({ id: UUID_A }), { username: 'Taken', usernameSelected: true }),
    'contested username'
  );

  assertEqual(failure.status, 400, 'a taken username is a client error');
  assert(failure.error.includes('already taken'), `expected an "already taken" message, got "${failure.error}"`);
  assertEqual(rawRow(UUID_A).username, 'user_placeholder', 'and nothing is written');
});

test('re-claiming your own username in a different case is allowed', async () => {
  seed({ id: UUID_A, username: 'ada', username_selected: true });

  const user = expectOk(
    await syncUser(stackUser({ id: UUID_A }), { username: 'ADA', usernameSelected: true }),
    'self re-claim'
  );

  assertEqual(user.username, 'ada', 'a case-only change resolves back to the same stored value');
});

test('invalid usernames are rejected with the validator message', async () => {
  const invalid: Array<[string, string]> = [
    ['a', 'at least 2 characters'],
    ['   ', 'required'],
    ['has space', 'letters, numbers, and underscores'],
    ['bad!name', 'letters, numbers, and underscores'],
    ['x'.repeat(21), '20 characters or less'],
  ];

  for (const [candidate, fragment] of invalid) {
    rows.clear();
    seed({ id: UUID_A, username: 'user_placeholder' });

    const failure = expectErr(
      await syncUser(stackUser({ id: UUID_A }), { username: candidate, usernameSelected: true }),
      `username "${candidate}"`
    );
    assertEqual(failure.status, 400, `"${candidate}" must be a 400`);
    assert(
      failure.error.includes(fragment),
      `"${candidate}": expected an error mentioning "${fragment}", got "${failure.error}"`
    );
    assertEqual(rawRow(UUID_A).username, 'user_placeholder', `"${candidate}" must not be written`);
  }
});

test('an empty username with username_selected is a no-op, not a rename', async () => {
  seed({ id: UUID_A, username: 'ada', username_selected: true });

  const user = expectOk(
    await syncUser(stackUser({ id: UUID_A }), { username: '', usernameSelected: true }),
    'empty username'
  );

  assertEqual(user.username, 'ada', 'an empty string leaves the username alone');
  assertEqual(rawRow(UUID_A).username_selected, true, 'and does not clear the selected flag');
});

test('a username chosen at first sign-in is applied to the newly created row', async () => {
  const user = expectOk(
    await syncUser(
      stackUser({
        id: UUID_A,
        primaryEmail: 'ada@example.com',
        primaryEmailVerified: true,
        displayName: 'Ada Lovelace',
      }),
      { username: 'ada_l', usernameSelected: true }
    ),
    'chosen at creation'
  );

  assertEqual(user.username, 'ada_l', 'the chosen name wins over the derived one');
  assertEqual(user.username_selected, true, 'and it is flagged as selected');
});

// ===========================================================================
// Concurrency: two requests racing to create the same identity
// ===========================================================================

test('a concurrent INSERT of the same row id resolves to an update, not a 500', async () => {
  beforeCreate = () => {
    // A sibling request wins the race between our `get` and our INSERT.
    seed({ id: UUID_A, username: 'ada', email: 'ada@example.com' });
  };

  const user = expectOk(
    await syncUser(
      stackUser({
        id: UUID_A,
        primaryEmail: 'ada@example.com',
        primaryEmailVerified: true,
        displayName: 'Ada',
        oauthProviderIds: ['google'],
      })
    ),
    'create race on the primary key'
  );

  assertEqual(user.id, UUID_A, 'the racing row is adopted');
  assertEqual(user.username, 'ada', 'and keeps the username the winner wrote');
  assertEqual(providersOf(user), ['google'], 'while our observed auth method is still merged in');
  assertEqual(rows.size, 1, 'exactly one row exists for this human');
});

test('a username claimed mid-flight falls back to the placeholder rather than failing', async () => {
  beforeCreate = () => {
    beforeCreate = null;
    seed({ id: 'sniper', username: 'ada' });
  };

  const user = expectOk(await syncUser(stackUser({ id: UUID_A, displayName: 'Ada' })), 'username claimed mid-flight');

  assertEqual(user.id, UUID_A, 'the user still gets a row');
  assertEqual(user.username, derivePlaceholderUsername(UUID_A), 'under an id-derived name nobody else can take');
});

test('an email claimed mid-flight drops the email rather than failing the sign-in', async () => {
  beforeCreate = () => {
    beforeCreate = null;
    seed({ id: 'sniper', username: 'sniper', email: 'ada@example.com' });
  };

  const user = expectOk(
    await syncUser(
      stackUser({ id: UUID_A, primaryEmail: 'ada@example.com', primaryEmailVerified: true, displayName: 'Ada' })
    ),
    'email claimed mid-flight'
  );

  assertEqual(user.id, UUID_A, 'the user still gets a row');
  assertEqual(user.email, undefined, 'without the email, which the other row won');
  assertEqual(rawRow('sniper').email, 'ada@example.com', 'and the winner keeps it');
});

test('a chosen username lost mid-flight surfaces as a 400, not a silent rename', async () => {
  beforeCreate = () => {
    beforeCreate = null;
    seed({ id: 'sniper', username: 'ada_l' });
  };

  const failure = expectErr(
    await syncUser(stackUser({ id: UUID_A, displayName: 'Ada' }), { username: 'ada_l', usernameSelected: true }),
    'chosen username lost mid-flight'
  );

  assertEqual(failure.status, 400, 'the human is told their pick is gone');
  assert(failure.error.includes('already taken'), `expected "already taken", got "${failure.error}"`);
  assert(!rows.has(UUID_A), 'and no row is created under a name they did not choose');
});

// ===========================================================================
// Cost / shape of the write path
// ===========================================================================

test('creating a user does not spend an extra UPDATE undoing the INSERT', async () => {
  statements = [];
  expectOk(await syncUser(stackUser({ id: UUID_A, displayName: 'Ada' })), 'new user');

  const updates = statements.filter(s => s.startsWith('update:'));
  assertEqual(updates.length, 1, `a new user should cost one UPDATE (last_seen_at), got: ${JSON.stringify(updates)}`);
  assert(
    !updates.some(s => s.includes('username_selected')),
    'username_selected must be correct straight from the INSERT'
  );
});

// ===========================================================================
// Tombstones (merged_into) — a retired id resolves to the account that
// absorbed it, and is never patched back into a working identity
// ===========================================================================

test('signing in on a merged-away id returns the surviving account', async () => {
  // The shape scripts/merge-duplicate-users.ts --keep-tombstones leaves behind:
  // the loser keeps its row, with merged_into set and its email cleared.
  seed({ id: UUID_A, username: 'ada_old', merged_into: UUID_B, email: null, last_seen_at: '2020-01-01T00:00:00.000Z' });
  seed({ id: UUID_B, username: 'ada', email: 'ada@example.com' });

  const user = expectOk(
    await syncUser(
      stackUser({ id: UUID_A, primaryEmail: 'ada@example.com', primaryEmailVerified: true, oauthProviderIds: ['google'] })
    ),
    'tombstoned row'
  );

  assertEqual(user.id, UUID_B, 'the sync resolves to the canonical account, not the tombstone');
  assertEqual(user.merged_into, null, 'and the row handed back is a live one');
  assertEqual(providersOf(user), ['google'], 'the sign-in method is linked onto the survivor');
  assert(logged.some(line => line.includes(UUID_B) && line.includes('merged into')), 'the redirect is logged');
});

test('the tombstone itself is left untouched by the redirect', async () => {
  seed({ id: UUID_A, username: 'ada_old', merged_into: UUID_B, email: null, last_seen_at: '2020-01-01T00:00:00.000Z' });
  seed({ id: UUID_B, username: 'ada', email: 'ada@example.com' });

  expectOk(await syncUser(stackUser({ id: UUID_A, displayName: 'Ada Reborn' })), 'tombstoned row');

  const tomb = rawRow(UUID_A);
  assertEqual(tomb.merged_into, UUID_B, 'the pointer is preserved, not cleared');
  assertEqual(tomb.last_seen_at, '2020-01-01T00:00:00.000Z', 'last_seen_at is not bumped on a retired row');
  assertEqual(tomb.display_name, null, 'no profile field is written back onto it');
  assert(!statements.some(s => s.startsWith(`update:${UUID_A}`)), 'the tombstone is never UPDATEd');
});

test('a multi-hop merge chain is followed all the way to the live account', async () => {
  const UUID_C = 'b95d1f70-6c3a-4b52-9f88-1d2e4a6c8b09';
  seed({ id: UUID_A, username: 'ada_oldest', merged_into: UUID_B });
  seed({ id: UUID_B, username: 'ada_old', merged_into: UUID_C });
  seed({ id: UUID_C, username: 'ada', email: 'ada@example.com' });

  const user = expectOk(await syncUser(stackUser({ id: UUID_A })), 'two-hop chain');

  assertEqual(user.id, UUID_C, 'both hops are followed');
  assertEqual(rawRow(UUID_B).merged_into, UUID_C, 'the intermediate tombstone is left alone');
});

test('a merge cycle fails closed instead of resurrecting a tombstone', async () => {
  seed({ id: UUID_A, username: 'ada_a', merged_into: UUID_B });
  seed({ id: UUID_B, username: 'ada_b', merged_into: UUID_A });

  const failure = expectErr(await syncUser(stackUser({ id: UUID_A })), 'cyclic chain');

  assertEqual(failure.status, 500, 'an unresolvable chain is a server-side data error');
  assert(!statements.some(s => s.startsWith('update:')), 'and nothing is written');
});

test('a merged_into pointing at a row that no longer exists fails closed', async () => {
  seed({ id: UUID_A, username: 'ada_old', merged_into: UUID_B });

  const failure = expectErr(await syncUser(stackUser({ id: UUID_A })), 'dangling pointer');

  assertEqual(failure.status, 500, 'a dangling tombstone is not silently revived');
  assert(!statements.some(s => s.startsWith('update:')), 'and nothing is written');
});

test('a retired account never renames the survivor that absorbed it', async () => {
  seed({ id: UUID_A, username: 'bob_old', merged_into: UUID_B, email: null });
  seed({ id: UUID_B, username: 'ada', email: 'ada@example.com' });

  const user = expectOk(
    await syncUser(stackUser({ id: UUID_A, primaryEmail: 'bob@example.com', primaryEmailVerified: true })),
    'tombstoned row with its own verified email'
  );

  assertEqual(user.id, UUID_B, 'still resolves to the survivor');
  assertEqual(user.email, 'ada@example.com', 'the survivor keeps the address the merge picked');
  assertEqual(user.auth_methods![0].identifier, 'bob@example.com', 'the method still records how they signed in');
});

test('a survivor with no email adopts the one the retired account verified', async () => {
  seed({ id: UUID_A, username: 'bob_old', merged_into: UUID_B, email: null });
  seed({ id: UUID_B, username: 'ada', email: null });

  const user = expectOk(
    await syncUser(stackUser({ id: UUID_A, primaryEmail: 'bob@example.com', primaryEmailVerified: true })),
    'tombstoned row, survivor has no email'
  );

  assertEqual(user.id, UUID_B, 'still resolves to the survivor');
  assertEqual(user.email, 'bob@example.com', 'an empty survivor picks the address up');
});

test('an email the tombstone still holds is not copied onto the survivor', async () => {
  // --keep-tombstones clears the loser's email, but a hand-written merge may
  // not have. Writing it onto the survivor would trip idx_users_email_lower.
  seed({ id: UUID_A, username: 'bob_old', merged_into: UUID_B, email: 'bob@example.com' });
  seed({ id: UUID_B, username: 'ada', email: null });

  const user = expectOk(
    await syncUser(stackUser({ id: UUID_A, primaryEmail: 'bob@example.com', primaryEmailVerified: true })),
    'tombstoned row still holding its email'
  );

  assertEqual(user.id, UUID_B, 'still resolves to the survivor');
  assertEqual(user.email, undefined, 'the address stays where it is rather than raising a unique violation');
  assertEqual(rawRow(UUID_A).email, 'bob@example.com', 'the tombstone keeps it');
  assert(logged.some(line => line.includes('users:merge')), 'and the operator is told how to fix it');
});

test('a username chosen while signed in on a retired id lands on the survivor', async () => {
  seed({ id: UUID_A, username: 'ada_old', merged_into: UUID_B });
  seed({ id: UUID_B, username: 'ada', email: 'ada@example.com' });

  const user = expectOk(
    await syncUser(stackUser({ id: UUID_A }), { username: 'Ada_L', usernameSelected: true }),
    'username choice on a tombstoned session'
  );

  assertEqual(user.id, UUID_B, 'the survivor is renamed');
  assertEqual(user.username, 'ada_l', 'to the chosen name');
  assertEqual(rawRow(UUID_A).username, 'ada_old', 'the tombstone keeps its own name');
});

test('re-confirming the survivor’s own username is not a conflict', async () => {
  // resolveExplicitUsername compares the holder against the row being written;
  // checking it against the signed-in (tombstoned) id would reject this.
  seed({ id: UUID_A, username: 'ada_old', merged_into: UUID_B });
  seed({ id: UUID_B, username: 'ada', email: 'ada@example.com' });

  const user = expectOk(
    await syncUser(stackUser({ id: UUID_A }), { username: 'ada', usernameSelected: true }),
    'survivor re-confirming its own username'
  );

  assertEqual(user.id, UUID_B, 'resolves to the survivor');
  assertEqual(user.username_selected, true, 'and the name is now marked as chosen');
});

// ===========================================================================
// Module hygiene
// ===========================================================================

test('lib/sync-user.ts loads outside a Next.js server bundle', async () => {
  const mod = await import('@/lib/sync-user');
  assertEqual(typeof mod.syncUser, 'function', 'syncUser is exported');
  assertEqual(typeof mod.derivePlaceholderUsername, 'function', 'derivePlaceholderUsername is exported');
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  const realUsers = db.users;
  (db as unknown as { users: unknown }).users = fakeUsers;

  console.log(`\n🧪 lib/sync-user.ts — ${cases.length} integration tests\n`);

  let passed = 0;
  const failures: string[] = [];

  for (const testCase of cases) {
    beginTest();
    try {
      await testCase.fn();
      endTest();
      passed++;
      console.log(`  ✅ ${testCase.name}`);
    } catch (err: any) {
      endTest();
      failures.push(testCase.name);
      console.log(`  ❌ ${testCase.name}`);
      console.log(`     ${String(err?.message ?? err).split('\n').join('\n     ')}`);
    }
  }

  (db as unknown as { users: unknown }).users = realUsers;

  console.log(`\n📊 ${passed}/${cases.length} passed, ${failures.length} failed\n`);

  if (failures.length > 0) {
    console.log('Failures:');
    for (const name of failures) console.log(`   - ${name}`);
    console.log('');
    process.exit(1);
  }

  console.log('🎉 lib/sync-user.ts integration verified.\n');
  process.exit(0);
}

main().catch(err => {
  endTest();
  console.error('❌ Test harness crashed:', err);
  process.exit(1);
});
