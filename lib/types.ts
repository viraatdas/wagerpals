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
  created_at?: string;
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
export interface Wallet {
  user_id: string;
  balance: number;
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
