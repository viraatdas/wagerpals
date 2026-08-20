export type AuthMethodProvider = 'password' | 'google' | 'apple' | 'passkey' | 'stack' | 'other';

export interface AuthMethod {
  provider: AuthMethodProvider;
  identifier?: string | null;
  linked_at?: string;
}

export interface User {
  id: string;
  username: string;
  username_selected?: boolean;
  net_total: number;
  total_bet: number;
  streak: number;
  email?: string;
  display_name?: string;
  avatar_url?: string;
  auth_methods?: AuthMethod[];
  // Tombstone pointer: when set, this user row has been merged/deduped into
  // the user with this id and should be treated as inactive.
  merged_into?: string | null;
  last_seen_at?: string;
}

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
  resolution?: {
    winning_side: string;
    resolved_at: number;
  };
  // NOTE: the DB column is NOT NULL DEFAULT 'none'/TRUE and every db.events.*
  // accessor always populates these, so they are effectively always present
  // on rows read from the database. They are kept OPTIONAL on the type
  // (rather than required) because existing call sites (e.g.
  // app/api/events/route.ts) construct `Event` object literals without them
  // ahead of insert, relying on the DB default — making them required here
  // would break `npx tsc --noEmit` in files this task is not permitted to
  // edit. Treat them as present when read back from db.events.*.
  payment_type?: PaymentType;
  stake_amount?: number | null;
  subject_user_id?: string | null;
  notify_subject?: boolean;
  // R2: the only person who may resolve/unresolve/cancel/delete this event.
  // NULL on rows created before this column existed — callers fall back to
  // the event's group.created_by for those legacy rows (see
  // app/api/events/resolve|unresolve|delete/route.ts). Set once, from the
  // authenticated caller, at creation (POST /api/events) — never taken from
  // the request body, and never changed afterward.
  created_by?: string | null;
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
  // Populated by db.bets.getByEvent via a LEFT JOIN onto users — lets the
  // Ledger (and mobile EventDetailScreen) render the bettor's real avatar
  // instead of always falling back to initials. Absent from other db.bets.*
  // accessors that don't join users; treat a missing value as "show initials".
  avatar_url?: string | null;
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
  // Populated by db.activities.getAll / getByUserGroups via a batched JOIN
  // against events — lets the History feed distinguish a W (play) bet from
  // a $ (cash) one without a second round trip. Absent when the owning
  // event has since been deleted (activities carry no FK to events, so a
  // row can outlive its event).
  payment_type?: PaymentType;
}

/** One entry in EventWithStats.bettor_preview — see that field's doc comment. */
export interface EventBettorPreview {
  username: string;
  avatar_url?: string;
  side: string;
}

/** EventWithStats.latest_comment — see that field's doc comment. */
export interface EventLatestComment {
  username: string;
  content: string;
}

export interface EventWithStats extends Event {
  side_stats: Record<string, { count: number; total: number }>;
  total_bets: number;
  total_participants: number;
  bets: Bet[];
  // Populated only by db.events.getAllWithStats (the list query); absent elsewhere.
  comment_count?: number;
  // Populated only by db.events.getAllWithStats (the list query); absent elsewhere
  // (including the ?id= detail payload, which has the full `bets` array instead).
  // Up to ~6 most-recently-active DISTINCT bettors for the event (one entry per
  // user_id, keyed off their latest bet), with the side they backed — lets list
  // cards render avatar clusters without a second round trip. Same disclosure
  // level as the existing `bets` array on the detail payload (both are
  // unauthenticated reads today), just batched for the list.
  bettor_preview?: EventBettorPreview[];
  // Populated only by db.events.getAllWithStats (the list query); absent elsewhere.
  // The single most recent top-level (non-reply) comment on the event, content
  // trimmed server-side to ~140 chars. Same disclosure level as reading comments
  // directly for an event id today, just batched for the list.
  latest_comment?: EventLatestComment;
  // Populated only by db.events.getAllWithStats (the list query) via a
  // batched JOIN — cheap because it rides along on the same query, not a
  // second round trip. Lets the UI show/hide resolve controls in list views
  // without fetching every event's detail payload. Absent (not just null)
  // when created_by is NULL (legacy row) or the creator user row is gone.
  creator_username?: string | null;
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

export interface PushSubscription {
  id?: number;
  user_id?: string;
  endpoint: string;
  p256dh?: string;
  auth?: string;
  expo_token?: string;
  platform?: 'web' | 'mobile';
}

export interface Group {
  id: string;
  name: string;
  created_by: string;
  resolver_user_id?: string;
  is_public: boolean;
  cash_enabled: boolean;
  created_at?: string;
}

export interface GroupMember {
  id?: number;
  group_id: string;
  user_id: string;
  username?: string;
  // Populated by db.groupMembers.getByGroup / getPendingByGroup via a JOIN
  // onto users — lets the group roster and admin/manage rows render real
  // avatars instead of always falling back to initials. Same disclosure
  // level as `username`, which the same JOIN already exposed.
  avatar_url?: string | null;
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
  // Populated by db.comments.get / getByEvent / getReplies via a JOIN onto
  // users — lets CommentThread render the commenter's real avatar instead of
  // always falling back to initials. Same disclosure level as `username`,
  // which the same JOIN already exposed. Never set on a scrubbed tombstone
  // (content/username are blanked too — see app/api/comments/route.ts).
  avatar_url?: string | null;
  parent_id?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
}

export interface CommentReaction {
  id?: number;
  comment_id: string;
  user_id: string;
  emoji: string;
  created_at?: string;
}

export interface CommentReactionSummary {
  emoji: string;
  count: number;
  user_ids: string[];
}

export interface CommentMention {
  id?: number;
  comment_id: string;
  mentioned_user_id: string;
  created_at?: string;
}

export interface CommentWithMeta extends Comment {
  reactions: CommentReactionSummary[];
  mention_user_ids: string[];
  reply_count: number;
}

export interface GroupWithMembers extends Group {
  members: GroupMember[];
  member_count: number;
  admin_count: number;
}

// Wallet & Payments
// The W — WagerPals' play currency (see lib/payments.ts's header + the
// signup-grant/faucet mechanics). `Currency` names which ledger a money row
// moves: 'usd' is real money (Stripe-backed, deposit/withdraw eligible);
// 'wp' is the W (never interchangeable with usd — no Stripe path, no
// withdrawal).
export type Currency = 'usd' | 'wp';

export interface Wallet {
  user_id: string;
  balance: number;
  // The W balance. Same row as `balance` (one wallet per user) — additive,
  // never converted to/from `balance`.
  wp_balance: number;
  currency: string;
  updated_at?: string;
}

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
  stripe_payment_intent_id?: string;
  description?: string;
  created_at?: string;
  idempotency_key?: string | null;
  event_id?: string | null;
  // Which ledger this row moves. Deposits/withdrawals are always 'usd' — no
  // Stripe path or withdrawal exists for 'wp'. The signup grant and daily
  // faucet reuse type='deposit' with currency='wp' rather than widening the
  // `type` CHECK.
  currency: Currency;
}

// Escrow holds
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
  // Which ledger this hold moves — derived from the owning event's
  // payment_type at the time the hold was created ('cash' -> 'usd', 'none'
  // -> 'wp') and never changes afterward.
  currency: Currency;
}

// Notification preferences
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

export type EventNotificationMuteReason = 'subject_hidden' | 'user_muted';

export interface EventNotificationMute {
  id?: number;
  event_id: string;
  user_id: string;
  reason: EventNotificationMuteReason;
  created_at?: string;
}
