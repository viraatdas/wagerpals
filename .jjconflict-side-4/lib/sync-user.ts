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
 */
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
  return merged.some(m => !existingKeys.has(authMethodKey(m)));
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

async function syncExistingUser(
  existing: User,
  stackUser: AuthenticatedStackUser,
  email: string | null,
  emailToWrite: string | null,
  opts?: { username?: string; usernameSelected?: boolean }
): Promise<SyncUserResult> {
  const patch: Partial<User> = {};

  if (emailToWrite && emailToWrite !== existing.email) {
    patch.email = emailToWrite;
  }

  const displayName = stackUser.displayName?.trim();
  if (displayName && displayName !== existing.display_name) {
    patch.display_name = displayName;
  }

  const avatarUrl = stackUser.profileImageUrl?.trim();
  if (avatarUrl && avatarUrl !== existing.avatar_url) {
    patch.avatar_url = avatarUrl;
  }

  const incomingMethods = buildAuthMethodsFromStackUser(stackUser, email);
  const mergedMethods = mergeAuthMethods(existing.auth_methods || [], incomingMethods);
  if (authMethodsChanged(existing.auth_methods || [], mergedMethods)) {
    patch.auth_methods = mergedMethods;
  }

  if (opts?.usernameSelected === true && opts.username) {
    const resolved = await resolveExplicitUsername(opts.username, stackUser.id);
    if (!resolved.ok) return resolved;
    patch.username = resolved.username;
    patch.username_selected = true;
  }

  patch.last_seen_at = new Date().toISOString();

  const updated = await db.users.update(stackUser.id, patch);
  if (!updated) {
    return { ok: false, status: 500, error: 'Failed to sync user' };
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
    // Create race: another concurrent request may have created the row
    // between our `get` check and this `create` call. Fall through to the
    // update path instead of surfacing a 500.
    console.error('[syncUser] create failed, checking for a create race:', err);
    const raced = await db.users.get(stackUser.id);
    if (raced) {
      return syncExistingUser(raced, stackUser, email, emailToWrite, opts);
    }
    return { ok: false, status: 500, error: 'Failed to sync user' };
  }

  // db.users.create writes username_selected as `${user.username_selected || true}`,
  // i.e. it coerces `false` to `true`. Fix it up when the username was not
  // explicitly chosen by the human.
  if (!usernameSelectedFlag) {
    await db.users.update(stackUser.id, { username_selected: false });
  }
  await db.users.update(stackUser.id, { last_seen_at: nowIso });

  const created = await db.users.get(stackUser.id);
  if (!created) {
    return { ok: false, status: 500, error: 'Failed to sync user' };
  }
  return { ok: true, user: created };
}
