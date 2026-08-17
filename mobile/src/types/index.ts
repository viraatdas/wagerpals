// TypeScript types matching the web app

export interface User {
  id: string;
  username: string;
  net_total: number;
  total_bet: number;
  streak: number;
  username_selected?: boolean;
}

// Mirrors lib/types.ts PaymentType exactly. 'none' events are points-only;
// 'cash' events move real money through the escrow/wallet engine.
export type PaymentType = 'none' | 'cash';

export interface Event {
  id: string;
  title: string;
  description?: string;
  side_a: string;
  side_b: string;
  end_time: number;
  status: 'active' | 'resolved';
  group_id: string;
  is_public?: boolean;
  resolver?: GroupMember | null;
  resolution?: {
    winning_side: string;
    resolved_at: number;
  };
  // NOTE: same rationale as lib/types.ts — these columns are NOT NULL with
  // DB defaults and every db.events.* accessor always populates them, so
  // they're effectively always present on rows read back from the server.
  // Kept optional here (rather than required) so object literals built
  // ahead of insert don't need to supply them.
  payment_type?: PaymentType;
  stake_amount?: number | null;
  subject_user_id?: string | null;
  notify_subject?: boolean;
}

export interface Bet {
  id: string;
  event_id: string;
  user_id: string;
  username: string;
  side: string;
  amount: number;
  note?: string;
  timestamp: number;
  is_late: boolean;
  escrow_hold_id?: string | null;
}

export interface ActivityItem {
  type: 'bet' | 'resolution' | 'event_created' | 'comment';
  timestamp: number;
  event_id: string;
  event_title: string;
  group_id?: string;
  group_name?: string;
  user_id?: string;
  username?: string;
  side?: string;
  amount?: number;
  note?: string;
  winning_side?: string;
  content?: string;
}

export interface EventWithStats extends Event {
  side_stats: Record<string, { count: number; total: number }>;
  total_bets: number;
  total_participants: number;
  bets: Bet[];
  // GET /api/events?id= always includes this on the single-event response —
  // 0 for 'none' events, and the live held total (in dollars, not cents) for
  // 'cash' events. See app/api/events/route.ts:
  // `event.payment_type === 'cash' ? db.escrowHolds.getHeldTotalForEvent(id) : 0`.
  // Kept optional rather than required so any other EventWithStats-shaped
  // value assembled elsewhere doesn't have to fabricate this field.
  escrow_total?: number;
  // Escrow status of EVERY bet in this event, keyed by bet id, from the same
  // single-event response (`{}` for 'none' events). The per-bet escrow chip
  // must read from this, never from `bet.escrow_hold_id`: that column keeps
  // pointing at the hold after settlement/cancellation, so it can only answer
  // "was this ever escrowed", not "is it still". See app/api/events/route.ts
  // (`db.escrowHolds.getStatusByBetForEvent`) and components/Ledger.tsx,
  // which renders the web half of the same chip off the same field.
  escrow_by_bet?: Record<string, EscrowHoldStatus>;
}

export interface NetResult {
  user_id: string;
  username: string;
  net: number;
}

export interface Payment {
  from: string;
  to: string;
  amount: number;
}

export interface Group {
  id: string;
  name: string;
  created_by: string;
  resolver_user_id?: string;
  resolver?: GroupMember | null;
  is_public?: boolean;
  created_at?: string;
  is_admin?: boolean;
  member_count?: number;
  admin_count?: number;
}

export interface GroupMember {
  id?: number;
  group_id: string;
  user_id: string;
  username?: string;
  role: 'admin' | 'member';
  status: 'pending' | 'active';
  joined_at?: string;
}

export interface Comment {
  id: string;
  event_id: string;
  user_id: string;
  username: string;
  content: string;
  timestamp: number;
}

export interface GroupWithMembers extends Group {
  members: GroupMember[];
  member_count: number;
  admin_count: number;
}

export interface Wallet {
  user_id: string;
  balance: number;
  currency: string;
  updated_at?: string;
}

export interface AuthUser {
  id: string;
  email?: string;
  displayName?: string;
  primaryEmail?: string;
}

// Mirrors lib/types.ts Transaction exactly.
export interface Transaction {
  id: string;
  user_id: string;
  type:
    | 'deposit'
    | 'withdrawal'
    | 'bet_placed'
    | 'bet_refund'
    | 'winnings'
    | 'escrow_hold'
    | 'escrow_release'
    | 'payout'
    | 'refund';
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  description?: string;
  created_at?: string;
  event_id?: string | null;
  stripe_payment_intent_id?: string;
  idempotency_key?: string | null;
}

export type EscrowHoldStatus = 'held' | 'released' | 'refunded';

export interface EscrowHold {
  id: string;
  event_id: string;
  bet_id?: string | null;
  user_id: string;
  amount: number;
  status: EscrowHoldStatus;
  created_at?: string;
  released_at?: string | null;
}

// Only present on the wallet summary when the caller passed `eventId` — see
// lib/payments.ts getWalletSummary. Note the field is `escrow_held`, an
// object with the event-scoped holds/transactions/pot, not a bare number.
export interface EventWalletSummary {
  escrow_held: number;
  holds: EscrowHold[];
  transactions: Transaction[];
  pot: number;
  settled: boolean;
}

// Matches the exact JSON shape returned by GET /api/wallet (app/api/wallet/route.ts):
// { wallet, transactions, escrow_held_total, available, event? }.
export interface WalletSummary {
  wallet: Wallet;
  transactions: Transaction[];
  escrow_held_total: number;
  available: number;
  event?: EventWalletSummary;
}

// Notification preferences — mirrors lib/types.ts exactly.
export type NotificationCategory =
  | 'bets'
  | 'comments'
  | 'mentions'
  | 'resolutions'
  | 'invites'
  | 'group_activity'
  | 'payments';

export type NotificationCategories = Record<NotificationCategory, boolean>;

export const DEFAULT_NOTIFICATION_CATEGORIES: NotificationCategories = {
  bets: true,
  comments: true,
  mentions: true,
  resolutions: true,
  invites: true,
  group_activity: true,
  payments: true,
};

export interface NotificationPreferences {
  user_id: string;
  push_enabled: boolean;
  email_enabled: boolean;
  categories: NotificationCategories;
  updated_at?: string;
}
