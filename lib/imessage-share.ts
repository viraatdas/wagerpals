import crypto from 'crypto';
import type { Event, Bet } from './types';

// ---------------------------------------------------------------------------
// Share tokens
//
// The native iMessage extension inserts a message bubble that links back to
// this app (via shareUrlFor). Anyone who receives that bubble should be able
// to open it and take a side — even before they're a member of the group the
// wager lives in — but NO ONE else should be able to guess an event id and
// get the same access. A share token is the proof that the bearer actually
// received the bubble: it's an HMAC-SHA256 of the event id, keyed by a
// server-only secret, so it can't be forged without the key and it's bound
// to exactly one event (a token minted for event A will not verify for
// event B).
// ---------------------------------------------------------------------------

let warnedMissingSecret = false;

function getSecret(): string | null {
  const secret = process.env.IMESSAGE_SHARE_SECRET;
  if (secret) return secret;

  // Never fall back to a hardcoded/default secret — that would make every
  // token forgeable. Degrade instead: createShareToken returns null and
  // verifyShareToken returns false, which pushes callers back onto "must
  // already be a group member" as the only way in. Warn once so this
  // misconfiguration is visible in logs without spamming them on every
  // request.
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn(
      '[imessage-share] IMESSAGE_SHARE_SECRET is not set — iMessage share tokens are disabled. ' +
        'Recipients who are not already active members of the wager\'s group will not be able to ' +
        'take a side from the iMessage bubble until this is configured.'
    );
  }
  return null;
}

/**
 * Mint a share token proving the bearer received the iMessage bubble for
 * `eventId`. Returns null (rather than a forgeable fallback) when
 * IMESSAGE_SHARE_SECRET is not configured.
 */
export function createShareToken(eventId: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(eventId).digest('base64url');
}

/**
 * Verify a share token for `eventId`. Always false when the secret is
 * unconfigured or the token is missing/malformed/for a different event.
 * Uses a constant-time comparison (after an explicit length check, since
 * crypto.timingSafeEqual throws on mismatched lengths rather than returning
 * false).
 */
export function verifyShareToken(eventId: string, token: string | null | undefined): boolean {
  if (!token) return false;

  const expected = createShareToken(eventId);
  if (!expected) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(token);
  if (expectedBuf.length !== providedBuf.length) return false;

  try {
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

export function isShareTokenConfigured(): boolean {
  return !!process.env.IMESSAGE_SHARE_SECRET;
}

function appBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wagerpals.io';
  return base.replace(/\/+$/, '');
}

/**
 * Build the URL the iMessage bubble links to. `token` may be null (secret
 * unconfigured, or the caller intentionally omitted it) — in that case the
 * `t` query param is left off entirely rather than sent as the literal
 * string "null".
 */
export function shareUrlFor(eventId: string, token: string | null): string {
  const params = new URLSearchParams({ e: eventId });
  if (token) params.set('t', token);
  return `${appBaseUrl()}/invite?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Event preview
//
// Shared by app/api/imessage/bets/route.ts, app/api/imessage/bets/side/route.ts
// and app/api/events/preview/route.ts so all three return an identical shape
// for the iMessage bubble to render. `includeTotals` gates the two money
// fields: the public preview route only sets it true once a valid share
// token proves the caller actually received the bubble; the two
// authenticated iMessage routes always pass true since the caller has
// already proven membership (or a valid token) to reach them.
// ---------------------------------------------------------------------------

export interface EventPreview {
  id: string;
  title: string;
  side_a: string;
  side_b: string;
  end_time: number;
  status: 'active' | 'resolved';
  winning_side: string | null;
  payment_type: 'none' | 'cash';
  stake_amount: number | null;
  total_bets: number;
  total_participants: number;
  side_a_count: number;
  side_b_count: number;
  side_a_total: number | null;
  side_b_total: number | null;
}

export function buildEventPreview(event: Event, bets: Bet[], includeTotals: boolean): EventPreview {
  let sideACount = 0;
  let sideBCount = 0;
  let sideATotal = 0;
  let sideBTotal = 0;
  const participantIds = new Set<string>();

  for (const bet of bets) {
    participantIds.add(bet.user_id);
    if (bet.side === event.side_a) {
      sideACount++;
      sideATotal += bet.amount;
    } else if (bet.side === event.side_b) {
      sideBCount++;
      sideBTotal += bet.amount;
    }
  }

  return {
    id: event.id,
    title: event.title,
    side_a: event.side_a,
    side_b: event.side_b,
    end_time: event.end_time,
    status: event.status,
    winning_side: event.resolution?.winning_side ?? null,
    payment_type: event.payment_type ?? 'none',
    stake_amount: event.stake_amount ?? null,
    total_bets: bets.length,
    total_participants: participantIds.size,
    side_a_count: sideACount,
    side_b_count: sideBCount,
    side_a_total: includeTotals ? Math.round(sideATotal * 100) / 100 : null,
    side_b_total: includeTotals ? Math.round(sideBTotal * 100) / 100 : null,
  };
}
