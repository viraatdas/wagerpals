import { Bet, Event, NetResult, Payment } from './types';
import { formatW } from './odds';

export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * R4 "quiet bet" visibility rule: true when `viewerId` is the event's
 * subject AND the event's creator chose not to notify them
 * (`notify_subject === false`). When true the event must not exist for that
 * viewer anywhere: excluded from `GET /api/events` lists, 404 on detail,
 * absent from the activity feed, and unreachable through any other
 * event-scoped endpoint that looks the event up on this viewer's behalf.
 *
 * Enforced centrally in lib/db.ts: `db.events.get`, `db.events.getAllWithStats`,
 * and `db.activities.getByUserGroups` all call this before returning a row.
 * `app/api/events/route.ts` derives the viewer id from the session (falling
 * back to an anonymous/null viewer for the unauthenticated list/detail
 * reads that already existed) and passes it through.
 *
 * NOTE for future work: `app/api/comments/route.ts` and `app/api/bets/route.ts`
 * are outside this task's file scope. They still call `db.events.get(id)`
 * with no viewer id, so a hidden subject who already knows/guesses an event
 * id can still reach its comments/bets directly. Whoever owns those files
 * next should thread the caller's id through to `db.events.get(id, callerId)`
 * (or call this helper directly) and treat a hidden event as not found,
 * the same way app/api/events/route.ts does.
 */
export function isEventHiddenFromViewer(
  event: Pick<Event, 'subject_user_id' | 'notify_subject'> | null | undefined,
  viewerId: string | null | undefined
): boolean {
  if (!event || !viewerId) return false;
  return event.notify_subject === false && event.subject_user_id === viewerId;
}

export function calculateNetResults(bets: Bet[], winningSide: string): NetResult[] {
  const userTotals: Record<string, { username: string; bet: number; won: number }> = {};

  // Calculate total bets per side
  const sideTotals: Record<string, number> = {};
  bets.forEach(bet => {
    if (!bet.is_late) {
      sideTotals[bet.side] = (sideTotals[bet.side] || 0) + bet.amount;
    }
  });

  const totalPot = Object.values(sideTotals).reduce((sum, val) => sum + val, 0);
  const winningTotal = sideTotals[winningSide] || 0;

  // Calculate each user's net
  bets.forEach(bet => {
    if (bet.is_late) return;

    if (!userTotals[bet.user_id]) {
      userTotals[bet.user_id] = { username: bet.username, bet: 0, won: 0 };
    }

    userTotals[bet.user_id].bet += bet.amount;

    if (bet.side === winningSide && winningTotal > 0) {
      // Winner gets their share of the pot proportional to their bet
      const share = bet.amount / winningTotal;
      userTotals[bet.user_id].won += totalPot * share;
    }
  });

  return Object.entries(userTotals).map(([user_id, data]) => ({
    user_id,
    username: data.username,
    net: Math.round((data.won - data.bet) * 100) / 100, // Round to 2 decimal places then to whole dollars
  }));
}

export function calculatePayments(netResults: NetResult[]): Payment[] {
  const winners = netResults.filter(r => r.net > 0).sort((a, b) => b.net - a.net);
  const losers = netResults.filter(r => r.net < 0).sort((a, b) => a.net - b.net);

  const payments: Payment[] = [];
  let wi = 0;
  let li = 0;

  while (wi < winners.length && li < losers.length) {
    const winner = winners[wi];
    const loser = losers[li];
    const amount = Math.min(winner.net, Math.abs(loser.net));

    if (amount > 0) {
      payments.push({
        from: loser.username,
        to: winner.username,
        amount,
      });
    }

    winner.net -= amount;
    loser.net += amount;

    if (winner.net === 0) wi++;
    if (loser.net === 0) li++;
  }

  return payments;
}

export function formatTimeLeft(endTime: number): string {
  const now = Date.now();
  const diff = endTime - now;

  if (diff <= 0) return 'Ended';

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

export function formatAmount(amount: number, isPublic: boolean = false): string {
  if (isPublic) {
    // Play-money (W) amounts: plain-text glyph form, signed. Prefer the
    // <WAmount> component (components/WMark.tsx) wherever real markup can
    // render it — this text form exists for string-only contexts (modal
    // copy, aria-labels) that can't carry the SVG mark.
    return amount >= 0 ? `+${formatW(amount)}` : `-${formatW(Math.abs(amount))}`;
  }
  const formatted = amount.toFixed(2);
  return amount >= 0 ? `+$${formatted}` : `-$${Math.abs(amount).toFixed(2)}`;
}

// Username utilities
export function normalizeUsername(username: string): string {
  return username.toLowerCase().trim();
}

export function validateUsername(username: string): { valid: boolean; error?: string } {
  const trimmed = username.trim();
  
  if (trimmed.length === 0) {
    return { valid: false, error: 'Username is required' };
  }
  
  if (trimmed.length < 2) {
    return { valid: false, error: 'Username must be at least 2 characters' };
  }
  
  if (trimmed.length > 20) {
    return { valid: false, error: 'Username must be 20 characters or less' };
  }
  
  // Only allow alphanumeric characters and underscores
  const validPattern = /^[a-zA-Z0-9_]+$/;
  if (!validPattern.test(trimmed)) {
    return { valid: false, error: 'Username can only contain letters, numbers, and underscores' };
  }
  
  return { valid: true };
}

export function sanitizeUsername(username: string): string {
  // Remove all characters except alphanumeric and underscore, then trim
  let sanitized = username.replace(/[^a-zA-Z0-9_]/g, '');
  
  // If empty after sanitization, use a default
  if (sanitized.length === 0) {
    sanitized = 'user';
  }
  
  // Ensure it's at least 2 characters
  if (sanitized.length < 2) {
    sanitized = sanitized + Math.floor(Math.random() * 100);
  }
  
  // Trim to max 20 characters
  if (sanitized.length > 20) {
    sanitized = sanitized.substring(0, 20);
  }
  
  return sanitized;
}

