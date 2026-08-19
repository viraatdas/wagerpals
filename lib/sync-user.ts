import { db } from '@/lib/db';
import { validateUsername, normalizeUsername, sanitizeUsername } from '@/lib/utils';
import type { AuthenticatedStackUser } from '@/lib/auth';
import type { AuthMethod, User } from '@/lib/types';

// NOTE: this file intentionally does NOT import '@/lib/stack' (which pulls
// in `server-only`), so it can be safely imported by scripts/tests that load
// route modules outside a Next.js server bundle.

export type SyncUserResult =
  | { ok: true; user: User }
  | { ok: false; status: number; error: string };

/**
 * Deterministic, always-available fallback username derived from a Stack
 * Auth user id (a UUID). Guaranteed to satisfy validateUsername's 2-20 char
 * alphanumeric/underscore rule for any real Stack Auth id.
 */
export function derivePlaceholderUsername(stackUserId: string): string {
  const candidate = ('user_' + stackUserId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()).slice(0, 20);
  if (candidate.length < 2) return 'user_unknown';
  return candidate;
}

function buildAuthMethodsFromStackUser(stackUser: AuthenticatedStackUser, email: string | null): AuthMethod[] {
  const methods: AuthMethod[] = [];

  if (stackUser.hasPassword) {
    methods.push({ provider: 'password', identifier: email });
  }
  for (const providerId of stackUser.oauthProviderIds) {
    if (providerId === 'google') {
      methods.push({ provider: 'google', identifier: email });
    } else if (providerId === 'apple') {
      methods.push({ provider: 'apple', identifier: email });
    } else {
      methods.push({ provider: 'other', identifier: providerId });
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

/**
 * Union existing auth methods with newly-observed ones, de-duplicated on
 * provider+identifier. Entries that already existed keep their original
 * (earliest) linked_at; newly-added entries are stamped with `now`.
 *
 * A method recorded with no identifier — which is what we store while the
 * user's email is still unverified — is *upgraded in place* once the same
 * provider shows up carrying a real identifier. Without that, verifying an
 * email forks one sign-in method into two near-duplicate entries.
 */
function mergeAuthMethods(existing: AuthMethod[], incoming: AuthMethod[]): AuthMethod[] {
  const merged = new Map<string, AuthMethod>();
  for (const m of existing) {
    merged.set(authMethodKey(m), m);
  }
  const nowIso = new Date().toISOString();
  for (const m of incoming) {
    const key = authMethodKey(m);
    if (merged.has(key)) continue;

    if (m.identifier) {
      const blankKey = authMethodKey({ provider: m.provider, identifier: null });
      const blank = merged.get(blankKey);
      if (blank) {
        merged.delete(blankKey);
        merged.set(key, { ...m, linked_at: blank.linked_at ?? nowIso });
        continue;
      }
    }
    merged.set(key, { ...m, linked_at: nowIso });
  }
  return Array.from(merged.values());
}

function authMethodsChanged(existing: AuthMethod[], merged: AuthMethod[]): boolean {
  if (existing.length !== merged.length) return true;
  const existingKeys = new Set(existing.map(authMethodKey));
  return merged.some(m => !existingKeys.has(authMethodKey(m)));
}

/**
 * Classify the unique violation a failed INSERT raised, so the caller can
 * tell "somebody else created my row" from "the username/email I picked was
 * claimed in the moment between my availability check and my INSERT".
 */
function uniqueViolationTarget(err: any): 'id' | 'username' | 'email' | null {
  const detail = `${err?.constraint ?? ''} ${err?.message ?? ''}`;
  if (detail.includes('users_pkey')) return 'id';
  if (detail.includes('idx_users_email_lower')) return 'email';
  if (detail.includes('users_username_key') || detail.includes('username')) return 'username';
  return null;
}

type UsernameResolution = { ok: true; username: string } | { ok: false; status: number; error: string };

/** Validate + check availability of an explicitly user-chosen username. */
async function resolveExplicitUsername(rawUsername: string, currentUserId: string): Promise<UsernameResolution> {
  const validation = validateUsername(rawUsername);
  if (!validation.valid) {
    return { ok: false, status: 400, error: validation.error! };
  }
  const normalized = normalizeUsername(rawUsername);
  const holder = await db.users.getByUsername(normalized);
  if (holder && holder.id !== currentUserId) {
    return { ok: false, status: 400, error: `Username "${rawUsername.trim()}" is already taken` };
  }
  return { ok: true, username: normalized };
}

/**
 * How far a `merged_into` chain may be followed before we call the data
 * corrupt. scripts/merge-duplicate-users.ts re-points existing tombstones at
 * the new survivor (`UPDATE users SET merged_into = C WHERE merged_into = L`),
 * so a healthy chain is one hop; longer ones only arise from hand-written
 * merges, and are still worth following.
 */
const MAX_MERGE_HOPS = 16;

type CanonicalResolution = { ok: true; user: User } | { ok: false; status: number; error: string };

/**
 * Walk `merged_into` from a tombstoned row to the account that survived the
 * merge, following multi-hop chains (A → B → C) and refusing to loop on a
 * cycle or to chase a pointer at a row that no longer exists.
 *
 * Failing closed matters here: handing the tombstone back would revive an
 * identity the merge deliberately retired, splitting one human's history in
 * two again — exactly what `npm run users:merge` was run to undo.
 */
async function resolveCanonicalUser(tombstone: User): Promise<CanonicalResolution> {
  let current = tombstone;
  const seen = new Set<string>([current.id]);

  while (current.merged_into) {
    const nextId = current.merged_into;
    if (seen.has(nextId)) {
      console.error(`[syncUser] merged_into chain from ${tombstone.id} loops back to ${nextId}; refusing to resolve it`);
      return { ok: false, status: 500, error: 'Failed to sync user' };
    }
    if (seen.size > MAX_MERGE_HOPS) {
      console.error(
        `[syncUser] merged_into chain from ${tombstone.id} is longer than ${MAX_MERGE_HOPS} hops; refusing to follow it`
      );
      return { ok: false, status: 500, error: 'Failed to sync user' };
    }
    const next = await db.users.get(nextId);
    if (!next) {
      console.error(`[syncUser] user ${current.id} is merged into ${nextId}, which does not exist`);
      return { ok: false, status: 500, error: 'Failed to sync user' };
    }
    seen.add(nextId);
    current = next;
  }

  return { ok: true, user: current };
}

async function syncExistingUser(
  existing: User,
  stackUser: AuthenticatedStackUser,
  email: string | null,
  emailToWrite: string | null,
  opts?: { username?: string; usernameSelected?: boolean }
): Promise<SyncUserResult> {
  // A row carrying merged_into is a tombstone: the dedupe tool folded it into
  // another account. Signing in on that Stack Auth id has to land on the
  // survivor — patching the tombstone would resurrect the duplicate identity.
  let target = existing;
  if (existing.merged_into) {
    const canonical = await resolveCanonicalUser(existing);
    if (!canonical.ok) return canonical;
    target = canonical.user;
    console.warn(
      `[syncUser] stack account ${stackUser.id} was merged into ${target.id}; syncing the surviving row instead`
    );

    // syncUser resolved email ownership against the id that signed in, but we
    // are about to write a *different* row, so that answer no longer applies.
    // The survivor's own address always wins — the merge already picked it,
    // and a retired Stack account must not rename the account that absorbed
    // it. Only an empty survivor adopts the address, and only if it is free:
    // the tombstone may still be holding it, and copying it across would trip
    // idx_users_email_lower and turn a sign-in into a 500.
    if (emailToWrite && target.email) {
      emailToWrite = null;
    } else if (emailToWrite) {
      const owner = await db.users.getByEmail(emailToWrite);
      if (owner && owner.id !== target.id) {
        console.warn(
          `[syncUser] email ${emailToWrite} is still held by user ${owner.id}; not writing it onto ${target.id}. Run: npm run users:merge -- --apply`
        );
        emailToWrite = null;
      }
    }
  }

  const patch: Partial<User> = {};

  if (emailToWrite && emailToWrite !== target.email) {
    patch.email = emailToWrite;
  }

  const displayName = stackUser.displayName?.trim();
  if (displayName && displayName !== target.display_name) {
    patch.display_name = displayName;
  }

  const avatarUrl = stackUser.profileImageUrl?.trim();
  if (avatarUrl && avatarUrl !== target.avatar_url) {
    patch.avatar_url = avatarUrl;
  }

  const incomingMethods = buildAuthMethodsFromStackUser(stackUser, email);
  const mergedMethods = mergeAuthMethods(target.auth_methods || [], incomingMethods);
  if (authMethodsChanged(target.auth_methods || [], mergedMethods)) {
    patch.auth_methods = mergedMethods;
  }

  if (opts?.usernameSelected === true && opts.username) {
    const resolved = await resolveExplicitUsername(opts.username, target.id);
    if (!resolved.ok) return resolved;
    patch.username = resolved.username;
    patch.username_selected = true;
  }

  patch.last_seen_at = new Date().toISOString();

  const updated = await db.users.update(target.id, patch);
  if (!updated) {
    return { ok: false, status: 500, error: 'Failed to sync user' };
  }

  // A username change cascades into the tables that denormalize it at write
  // time (bets, comments, activities), so ledgers and feeds always show the
  // person's CURRENT username — without this, every rename leaves the old
  // name frozen on their history. Same statement shape as the one-off
  // backfill run on 2026-08-19. Best-effort: a cascade failure must not fail
  // the sync itself (the users row is already correct; the next rename or
  // backfill re-converges).
  if (patch.username && patch.username !== target.username) {
    try {
      await db.users.cascadeUsername(target.id, patch.username);
    } catch (err) {
      console.error('[syncUser] username cascade failed (non-fatal):', err);
    }
  }
  return { ok: true, user: updated };
}

/**
 * The single canonical path for creating/refreshing a `users` row from an
 * authenticated Stack Auth session. Both the web app and the mobile app
 * funnel through this (via POST /api/users).
 */
export async function syncUser(
  stackUser: AuthenticatedStackUser,
  opts?: { username?: string; usernameSelected?: boolean }
): Promise<SyncUserResult> {
  // Verified email only: an unverified email never claims an identity.
  const email = stackUser.primaryEmailVerified && stackUser.primaryEmail
    ? stackUser.primaryEmail.trim().toLowerCase()
    : null;

  // idx_users_email_lower is a UNIQUE index, so only write the email onto
  // this row when no other row already owns it.
  let emailToWrite: string | null = null;
  if (email) {
    const owner = await db.users.getByEmail(email);
    if (!owner || owner.id === stackUser.id) {
      emailToWrite = email;
    } else {
      console.warn(
        `[syncUser] email ${email} already belongs to user ${owner.id}; not writing it onto ${stackUser.id}. Run: npm run users:merge -- --apply`
      );
    }
  }

  const existing = await db.users.get(stackUser.id);
  if (existing) {
    return syncExistingUser(existing, stackUser, email, emailToWrite, opts);
  }

  // New row: decide the username.
  let username: string;
  let usernameSelectedFlag: boolean;
  if (opts?.usernameSelected === true && opts.username) {
    const resolved = await resolveExplicitUsername(opts.username, stackUser.id);
    if (!resolved.ok) return resolved;
    username = resolved.username;
    usernameSelectedFlag = true;
  } else {
    const base = sanitizeUsername(stackUser.displayName?.trim() || (email ? email.split('@')[0] : '') || '');
    if (validateUsername(base).valid && !(await db.users.getByUsername(base))) {
      username = normalizeUsername(base);
    } else {
      username = derivePlaceholderUsername(stackUser.id);
    }
    usernameSelectedFlag = false;
  }

  const nowIso = new Date().toISOString();
  const authMethods = buildAuthMethodsFromStackUser(stackUser, email).map(m => ({ ...m, linked_at: nowIso }));
  const displayName = stackUser.displayName?.trim() || undefined;
  const avatarUrl = stackUser.profileImageUrl?.trim() || undefined;

  const newUser: User = {
    id: stackUser.id,
    username,
    username_selected: usernameSelectedFlag,
    net_total: 0,
    total_bet: 0,
    streak: 0,
    email: emailToWrite ?? undefined,
    display_name: displayName,
    avatar_url: avatarUrl,
    auth_methods: authMethods,
  };

  try {
    await db.users.create(newUser);
  } catch (err) {
    // Every check above (row id, username availability, email ownership) is a
    // read followed by a write, so a concurrent request can invalidate any of
    // them in between. Recover rather than turning a sign-in into a 500.
    console.error('[syncUser] create failed, recovering:', err);

    const raced = await db.users.get(stackUser.id);
    if (raced) {
      // Another request created our row first — adopt it.
      return syncExistingUser(raced, stackUser, email, emailToWrite, opts);
    }

    const target = uniqueViolationTarget(err);
    if (target !== 'username' && target !== 'email') {
      return { ok: false, status: 500, error: 'Failed to sync user' };
    }
    if (target === 'username' && usernameSelectedFlag) {
      // The human typed this name; renaming them behind their back would be
      // worse than telling them it just went.
      return { ok: false, status: 400, error: `Username "${opts!.username!.trim()}" is already taken` };
    }

    // Retry once with a shape nobody else can be holding: a username derived
    // from this Stack Auth id, and no email (the row that won the race owns
    // it — `npm run users:merge` is what reunites the two afterwards).
    if (target === 'username') newUser.username = derivePlaceholderUsername(stackUser.id);
    if (target === 'email') newUser.email = undefined;

    try {
      await db.users.create(newUser);
    } catch (retryErr) {
      console.error('[syncUser] create retry failed:', retryErr);
      return { ok: false, status: 500, error: 'Failed to sync user' };
    }
  }

  await db.users.update(stackUser.id, { last_seen_at: nowIso });

  const created = await db.users.get(stackUser.id);
  if (!created) {
    return { ok: false, status: 500, error: 'Failed to sync user' };
  }
  return { ok: true, user: created };
}
