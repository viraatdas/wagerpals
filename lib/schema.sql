-- Wager Pals Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  username_selected BOOLEAN DEFAULT FALSE,
  net_total DECIMAL(10,2) DEFAULT 0,
  total_bet DECIMAL(10,2) DEFAULT 0,
  streak INTEGER DEFAULT 0,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  auth_methods JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of {provider, identifier, linked_at}
  merged_into TEXT REFERENCES users(id),           -- tombstone pointer for deduped accounts
  last_seen_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Groups table
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  resolver_user_id TEXT REFERENCES users(id),
  is_public BOOLEAN DEFAULT FALSE,
  cash_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Group Members table
CREATE TABLE IF NOT EXISTS group_members (
  id SERIAL PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'pending',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, user_id)
);

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  side_a TEXT NOT NULL,
  side_b TEXT NOT NULL,
  end_time BIGINT NOT NULL,
  status TEXT DEFAULT 'active',
  winning_side TEXT,
  resolved_at BIGINT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  payment_type TEXT NOT NULL DEFAULT 'none' CONSTRAINT events_payment_type_check CHECK (payment_type IN ('none', 'cash')),
  stake_amount DECIMAL(10,2),
  subject_user_id TEXT REFERENCES users(id),
  notify_subject BOOLEAN NOT NULL DEFAULT TRUE,
  -- R2: only this user (fallback: the group's created_by, for legacy rows
  -- where this is NULL) may resolve/unresolve/cancel/delete the event.
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bets table
CREATE TABLE IF NOT EXISTS bets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,
  side TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  note TEXT,
  is_late BOOLEAN DEFAULT FALSE,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Escrow Holds table (cash-stake holds tied to an event/bet/user). Declared after bets so its
-- bet_id FK can reference bets(id); bets.escrow_hold_id below is then added via ALTER TABLE
-- because the two tables have a circular, both-nullable FK relationship.
CREATE TABLE IF NOT EXISTS escrow_holds (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  bet_id TEXT REFERENCES bets(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL CONSTRAINT escrow_holds_amount_check CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'held' CONSTRAINT escrow_holds_status_check CHECK (status IN ('held', 'released', 'refunded')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP
);

-- bets.escrow_hold_id: added after escrow_holds exists (circular FK, both sides nullable)
ALTER TABLE bets ADD COLUMN IF NOT EXISTS escrow_hold_id TEXT REFERENCES escrow_holds(id) ON DELETE SET NULL;

-- Comments table
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  edited_at TIMESTAMP,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Comment Reactions table (emoji reactions on comments)
CREATE TABLE IF NOT EXISTS comment_reactions (
  id SERIAL PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(comment_id, user_id, emoji)
);

-- Comment Mentions table (@-mentions inside comments)
CREATE TABLE IF NOT EXISTS comment_mentions (
  id SERIAL PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  mentioned_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(comment_id, mentioned_user_id)
);

-- Activities table
CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_title TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  username TEXT,
  side TEXT,
  amount DECIMAL(10,2),
  note TEXT,
  winning_side TEXT,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Push Subscriptions table (supports both web push and Expo)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT,
  auth TEXT,
  expo_token TEXT,
  platform TEXT DEFAULT 'web',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notification Preferences table (one row per user)
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  categories JSONB NOT NULL DEFAULT '{"bets":true,"comments":true,"mentions":true,"resolutions":true,"invites":true,"group_activity":true,"payments":true}'::jsonb,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Event Notification Mutes table (per-user, per-event notification opt-out)
CREATE TABLE IF NOT EXISTS event_notification_mutes (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT 'user_muted', -- documented values: 'subject_hidden' | 'user_muted'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, user_id)
);

-- Wallets table (real money)
CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance DECIMAL(10,2) DEFAULT 0 CHECK (balance >= 0),
  currency TEXT DEFAULT 'usd',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table (deposit/withdrawal/bet/escrow ledger)
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CONSTRAINT transactions_type_check CHECK (type IN (
    'deposit', 'withdrawal', 'bet_placed', 'bet_refund', 'winnings',
    'escrow_hold', 'escrow_release', 'payout', 'refund'
  )),
  amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id TEXT,
  description TEXT,
  idempotency_key TEXT,
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_bets_event_id ON bets(event_id);
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_escrow_hold_id ON bets(escrow_hold_id) WHERE escrow_hold_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_event_id ON comments(event_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_event_timestamp ON comments(event_id, timestamp ASC);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment_id ON comment_reactions(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_user_id ON comment_reactions(user_id);
CREATE INDEX IF NOT EXISTS idx_comment_mentions_comment_id ON comment_mentions(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_mentions_mentioned_user_id ON comment_mentions(mentioned_user_id);
CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_group_id ON events(group_id);
CREATE INDEX IF NOT EXISTS idx_events_payment_type ON events(payment_type);
CREATE INDEX IF NOT EXISTS idx_events_subject_user_id ON events(subject_user_id) WHERE subject_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_escrow_holds_event_id ON escrow_holds(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_holds_bet_id ON escrow_holds(bet_id) WHERE bet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_escrow_holds_user_id ON escrow_holds(user_id);
CREATE INDEX IF NOT EXISTS idx_escrow_holds_status ON escrow_holds(status);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_merged_into ON users(merged_into) WHERE merged_into IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_notification_mutes_event_id ON event_notification_mutes(event_id);
CREATE INDEX IF NOT EXISTS idx_event_notification_mutes_user_id ON event_notification_mutes(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_stripe_id ON transactions(stripe_payment_intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency_key ON transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_event_id ON transactions(event_id) WHERE event_id IS NOT NULL;
