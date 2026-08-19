import { sql, db as pgPool, type VercelPoolClient } from '@vercel/postgres';
import {
  User,
  AuthMethod,
  Event,
  PaymentType,
  Bet,
  ActivityItem,
  PushSubscription,
  Group,
  GroupMember,
  Comment,
  CommentWithMeta,
  CommentReactionSummary,
  CommentMention,
  Wallet,
  Transaction,
  EscrowHold,
  EscrowHoldStatus,
  NotificationPreferences,
  NotificationCategory,
  NotificationCategories,
  DEFAULT_NOTIFICATION_CATEGORIES,
  EventNotificationMute,
} from './types';

// @vercel/postgres returns JSONB columns already parsed as a JS value, but
// be defensive: null/undefined -> [], arrays pass through, strings get
// JSON.parse-ed (covers drivers/pools that hand back JSONB as text).
function parseAuthMethods(value: unknown): AuthMethod[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value as AuthMethod[];
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

// Merge a partial categories object over the documented defaults so a
// partial update (or a legacy row) never drops keys.
function parseNotificationCategories(value: unknown): NotificationCategories {
  let parsed: Partial<NotificationCategories> = {};
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = {};
    }
  } else if (value && typeof value === 'object') {
    parsed = value as Partial<NotificationCategories>;
  }
  return { ...DEFAULT_NOTIFICATION_CATEGORIES, ...parsed };
}

function mapEvent(row: any): Event {
  const event: Event = {
    id: row.id,
    title: row.title,
    description: row.description,
    side_a: row.side_a,
    side_b: row.side_b,
    end_time: parseInt(row.end_time),
    group_id: row.group_id,
    status: row.status,
    payment_type: (row.payment_type as PaymentType) || 'none',
    stake_amount: row.stake_amount !== null && row.stake_amount !== undefined ? parseFloat(row.stake_amount) : null,
    subject_user_id: row.subject_user_id ?? null,
    notify_subject: row.notify_subject === null || row.notify_subject === undefined ? true : row.notify_subject,
  };

  if (row.winning_side) {
    event.resolution = {
      winning_side: row.winning_side,
      resolved_at: parseInt(row.resolved_at),
    };
  }

  return event;
}

function mapBet(row: any): Bet {
  return {
    id: row.id,
    event_id: row.event_id,
    user_id: row.user_id,
    username: row.username,
    side: row.side,
    amount: parseFloat(row.amount),
    note: row.note || undefined,
    is_late: row.is_late,
    timestamp: parseInt(row.timestamp),
    escrow_hold_id: row.escrow_hold_id ?? null,
  };
}

function mapTransaction(row: any): Transaction {
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    amount: parseFloat(row.amount),
    status: row.status,
    stripe_payment_intent_id: row.stripe_payment_intent_id || undefined,
    description: row.description || undefined,
    created_at: row.created_at,
    idempotency_key: row.idempotency_key ?? null,
    event_id: row.event_id ?? null,
  };
}

function mapEscrowHold(row: any): EscrowHold {
  return {
    id: row.id,
    event_id: row.event_id,
    bet_id: row.bet_id ?? null,
    user_id: row.user_id,
    amount: parseFloat(row.amount),
    status: row.status,
    created_at: row.created_at,
    released_at: row.released_at ?? null,
  };
}

function mapNotificationPreferences(row: any): NotificationPreferences {
  return {
    user_id: row.user_id,
    push_enabled: row.push_enabled === null || row.push_enabled === undefined ? true : row.push_enabled,
    email_enabled: row.email_enabled === null || row.email_enabled === undefined ? false : row.email_enabled,
    categories: parseNotificationCategories(row.categories),
    updated_at: row.updated_at,
  };
}

function mapEventNotificationMute(row: any): EventNotificationMute {
  return {
    id: row.id,
    event_id: row.event_id,
    user_id: row.user_id,
    reason: row.reason,
    created_at: row.created_at,
  };
}

function mapComment(row: any): Comment {
  return {
    id: row.id,
    event_id: row.event_id,
    user_id: row.user_id,
    username: row.username,
    content: row.content,
    timestamp: parseInt(row.timestamp),
    parent_id: row.parent_id ?? null,
    edited_at: row.edited_at ?? null,
    deleted_at: row.deleted_at ?? null,
  };
}

function summarizeReactions(rows: Array<any>): CommentReactionSummary[] {
  const byEmoji = new Map<string, string[]>();
  for (const row of rows) {
    const list = byEmoji.get(row.emoji) || [];
    list.push(row.user_id);
    byEmoji.set(row.emoji, list);
  }
  return Array.from(byEmoji.entries()).map(([emoji, user_ids]) => ({
    emoji,
    count: user_ids.length,
    user_ids,
  }));
}

function mapUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    username_selected: row.username_selected || false,
    net_total: parseFloat(row.net_total),
    total_bet: parseFloat(row.total_bet || 0),
    streak: row.streak,
    email: row.email || undefined,
    display_name: row.display_name || undefined,
    avatar_url: row.avatar_url || undefined,
    auth_methods: parseAuthMethods(row.auth_methods),
    merged_into: row.merged_into ?? null,
    last_seen_at: row.last_seen_at || undefined,
  };
}

/**
 * Run several statements inside a single database transaction.
 *
 * Usage:
 *   await withTransaction(async (tx) => {
 *     await tx.sql`UPDATE wallets SET balance = balance - ${amount} WHERE user_id = ${userId}`;
 *     await tx.sql`INSERT INTO escrow_holds (id, event_id, user_id, amount) VALUES (${id}, ${eventId}, ${userId}, ${amount})`;
 *   });
 *
 * BEGINs on a dedicated pooled client, runs `fn`, COMMITs on success, and
 * ROLLBACKs + rethrows on any error. The client is always released back to
 * the pool. Every statement inside `fn` MUST go through the `tx` client
 * (tx.sql`...`) rather than the top-level `sql` import, or it will run
 * outside the transaction on a different connection.
 */
export async function withTransaction<T>(fn: (tx: VercelPoolClient) => Promise<T>): Promise<T> {
  const client = await pgPool.connect();
  try {
    await client.sql`BEGIN`;
    const result = await fn(client);
    await client.sql`COMMIT`;
    return result;
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

export const db = {
  users: {
    get: async (id: string): Promise<User | null> => {
      const result = await sql`SELECT * FROM users WHERE id = ${id}`;
      if (result.rows.length === 0) return null;
      return mapUser(result.rows[0]);
    },

    getByUsername: async (username: string): Promise<User | null> => {
      const result = await sql`SELECT * FROM users WHERE LOWER(username) = LOWER(${username})`;
      if (result.rows.length === 0) return null;
      return mapUser(result.rows[0]);
    },

    // Identity lookup keyed on the (case-insensitive) email address. Backed by
    // idx_users_email_lower, which is UNIQUE, so at most one row can match.
    // Tombstoned rows are still returned: a merged account's email must not be
    // handed out to a different human.
    getByEmail: async (email: string): Promise<User | null> => {
      const result = await sql`SELECT * FROM users WHERE LOWER(email) = LOWER(${email})`;
      if (result.rows.length === 0) return null;
      return mapUser(result.rows[0]);
    },

    // Tombstoned (merged/deduped) users are excluded so they stop showing
    // up on the leaderboard; db.users.get(id) still returns them directly.
    getAll: async (): Promise<User[]> => {
      const result = await sql`
        SELECT * FROM users
        WHERE merged_into IS NULL
        ORDER BY net_total DESC, total_bet DESC
      `;
      return result.rows.map(mapUser);
    },

    create: async (user: User): Promise<User> => {
      await sql`
        INSERT INTO users (id, username, username_selected, net_total, total_bet, streak, email, display_name, avatar_url, auth_methods)
        VALUES (
          ${user.id},
          ${user.username},
          ${user.username_selected ?? false},
          ${user.net_total},
          ${user.total_bet},
          ${user.streak},
          ${user.email || null},
          ${user.display_name || null},
          ${user.avatar_url || null},
          ${JSON.stringify(user.auth_methods || [])}
        )
      `;
      return user;
    },

    update: async (id: string, data: Partial<User>): Promise<User | null> => {
      if (data.username !== undefined) {
        await sql`UPDATE users SET username = ${data.username} WHERE id = ${id}`;
      }
      if (data.net_total !== undefined) {
        await sql`UPDATE users SET net_total = ${data.net_total} WHERE id = ${id}`;
      }
      if (data.total_bet !== undefined) {
        await sql`UPDATE users SET total_bet = ${data.total_bet} WHERE id = ${id}`;
      }
      if (data.streak !== undefined) {
        await sql`UPDATE users SET streak = ${data.streak} WHERE id = ${id}`;
      }
      if (data.username_selected !== undefined) {
        await sql`UPDATE users SET username_selected = ${data.username_selected} WHERE id = ${id}`;
      }
      if (data.email !== undefined) {
        await sql`UPDATE users SET email = ${data.email} WHERE id = ${id}`;
      }
      if (data.display_name !== undefined) {
        await sql`UPDATE users SET display_name = ${data.display_name} WHERE id = ${id}`;
      }
      if (data.avatar_url !== undefined) {
        await sql`UPDATE users SET avatar_url = ${data.avatar_url} WHERE id = ${id}`;
      }
      if (data.auth_methods !== undefined) {
        await sql`UPDATE users SET auth_methods = ${JSON.stringify(data.auth_methods)} WHERE id = ${id}`;
      }
      if (data.merged_into !== undefined) {
        await sql`UPDATE users SET merged_into = ${data.merged_into} WHERE id = ${id}`;
      }
      if (data.last_seen_at !== undefined) {
        await sql`UPDATE users SET last_seen_at = ${data.last_seen_at} WHERE id = ${id}`;
      }

      return await db.users.get(id);
    },
  },
  
  events: {
    get: async (id: string): Promise<Event | null> => {
      const result = await sql`SELECT * FROM events WHERE id = ${id}`;
      if (result.rows.length === 0) return null;
      return mapEvent(result.rows[0]);
    },

    getAll: async (): Promise<Event[]> => {
      const result = await sql`
        SELECT * FROM events
        ORDER BY
          CASE
            WHEN status = 'active' THEN 0
            ELSE 1
          END,
          end_time DESC
      `;

      return result.rows.map(mapEvent);
    },

    create: async (event: Event): Promise<Event> => {
      await sql`
        INSERT INTO events (id, title, description, side_a, side_b, end_time, group_id, status, payment_type, stake_amount, subject_user_id, notify_subject)
        VALUES (
          ${event.id},
          ${event.title},
          ${event.description || null},
          ${event.side_a},
          ${event.side_b},
          ${event.end_time},
          ${event.group_id},
          ${event.status},
          ${event.payment_type || 'none'},
          ${event.stake_amount ?? null},
          ${event.subject_user_id ?? null},
          ${event.notify_subject ?? true}
        )
      `;
      return event;
    },

    update: async (id: string, data: Partial<Event>): Promise<Event | null> => {
      if (data.status !== undefined) {
        await sql`UPDATE events SET status = ${data.status} WHERE id = ${id}`;
      }
      if (data.resolution !== undefined) {
        if (data.resolution) {
          await sql`
            UPDATE events
            SET winning_side = ${data.resolution.winning_side}, resolved_at = ${data.resolution.resolved_at}
            WHERE id = ${id}
          `;
        } else {
          await sql`
            UPDATE events
            SET winning_side = NULL, resolved_at = NULL
            WHERE id = ${id}
          `;
        }
      }
      if (data.payment_type !== undefined) {
        await sql`UPDATE events SET payment_type = ${data.payment_type} WHERE id = ${id}`;
      }
      if (data.stake_amount !== undefined) {
        await sql`UPDATE events SET stake_amount = ${data.stake_amount} WHERE id = ${id}`;
      }
      if (data.subject_user_id !== undefined) {
        await sql`UPDATE events SET subject_user_id = ${data.subject_user_id} WHERE id = ${id}`;
      }
      if (data.notify_subject !== undefined) {
        await sql`UPDATE events SET notify_subject = ${data.notify_subject} WHERE id = ${id}`;
      }

      return await db.events.get(id);
    },
    
    delete: async (id: string): Promise<void> => {
      await sql`DELETE FROM events WHERE id = ${id}`;
    },

    // Optimized: get all events with bet stats in a single query (fixes N+1)
    getAllWithStats: async (groupId?: string): Promise<any[]> => {
      const result = groupId
        ? await sql`
            SELECT
              e.*,
              COALESCE(COUNT(b.id), 0)::int as total_bets,
              COALESCE(COUNT(DISTINCT b.user_id), 0)::int as total_participants,
              COALESCE(SUM(CASE WHEN b.side = e.side_a THEN 1 ELSE 0 END), 0)::int as side_a_count,
              COALESCE(SUM(CASE WHEN b.side = e.side_a THEN b.amount ELSE 0 END), 0)::numeric as side_a_total,
              COALESCE(SUM(CASE WHEN b.side = e.side_b THEN 1 ELSE 0 END), 0)::int as side_b_count,
              COALESCE(SUM(CASE WHEN b.side = e.side_b THEN b.amount ELSE 0 END), 0)::numeric as side_b_total,
              (SELECT COUNT(*) FROM comments c WHERE c.event_id = e.id AND c.deleted_at IS NULL)::int AS comment_count
            FROM events e
            LEFT JOIN bets b ON e.id = b.event_id
            WHERE e.group_id = ${groupId}
            GROUP BY e.id
            ORDER BY
              CASE WHEN e.status = 'active' THEN 0 ELSE 1 END,
              e.end_time DESC
          `
        : await sql`
            SELECT
              e.*,
              COALESCE(COUNT(b.id), 0)::int as total_bets,
              COALESCE(COUNT(DISTINCT b.user_id), 0)::int as total_participants,
              COALESCE(SUM(CASE WHEN b.side = e.side_a THEN 1 ELSE 0 END), 0)::int as side_a_count,
              COALESCE(SUM(CASE WHEN b.side = e.side_a THEN b.amount ELSE 0 END), 0)::numeric as side_a_total,
              COALESCE(SUM(CASE WHEN b.side = e.side_b THEN 1 ELSE 0 END), 0)::int as side_b_count,
              COALESCE(SUM(CASE WHEN b.side = e.side_b THEN b.amount ELSE 0 END), 0)::numeric as side_b_total,
              (SELECT COUNT(*) FROM comments c WHERE c.event_id = e.id AND c.deleted_at IS NULL)::int AS comment_count
            FROM events e
            LEFT JOIN bets b ON e.id = b.event_id
            GROUP BY e.id
            ORDER BY
              CASE WHEN e.status = 'active' THEN 0 ELSE 1 END,
              e.end_time DESC
          `;

      const events: any[] = result.rows.map(row => {
        const event: any = {
          id: row.id,
          title: row.title,
          description: row.description,
          side_a: row.side_a,
          side_b: row.side_b,
          end_time: parseInt(row.end_time),
          group_id: row.group_id,
          status: row.status,
          payment_type: (row.payment_type as PaymentType) || 'none',
          stake_amount: row.stake_amount !== null && row.stake_amount !== undefined ? parseFloat(row.stake_amount) : null,
          subject_user_id: row.subject_user_id ?? null,
          notify_subject: row.notify_subject === null || row.notify_subject === undefined ? true : row.notify_subject,
          side_stats: {
            [row.side_a]: { count: parseInt(row.side_a_count), total: Math.round(parseFloat(row.side_a_total) * 100) / 100 },
            [row.side_b]: { count: parseInt(row.side_b_count), total: Math.round(parseFloat(row.side_b_total) * 100) / 100 },
          },
          total_bets: parseInt(row.total_bets),
          total_participants: parseInt(row.total_participants),
          comment_count: parseInt(row.comment_count) || 0,
        };

        if (row.winning_side) {
          event.resolution = {
            winning_side: row.winning_side,
            resolved_at: parseInt(row.resolved_at),
          };
        }

        return event;
      });

      // Batched (not N+1) enrichment: bettor_preview + latest_comment for every
      // event returned above, fetched in two queries keyed off the full id list
      // rather than one query per event — same pattern as
      // commentReactions.getByComments / notificationPreferences bulk lookups
      // elsewhere in this file (ANY(...::text[]) + a single GROUP/PARTITION).
      const eventIds = events.map(e => e.id);
      if (eventIds.length > 0) {
        const [bettorPreviewResult, latestCommentResult] = await Promise.all([
          // DISTINCT ON (event_id, user_id) collapses each bettor to their most
          // recent bet in the event (so a user who bet more than once shows up
          // once, with their latest side); the outer ROW_NUMBER() then caps each
          // event to its 6 most-recently-active distinct bettors.
          sql`
            WITH distinct_bettors AS (
              SELECT DISTINCT ON (b.event_id, b.user_id)
                b.event_id, b.user_id, b.username, b.side, b.timestamp, u.avatar_url
              FROM bets b
              LEFT JOIN users u ON u.id = b.user_id
              WHERE b.event_id = ANY(${eventIds as any}::text[])
              ORDER BY b.event_id, b.user_id, b.timestamp DESC
            ),
            ranked AS (
              SELECT *, ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY timestamp DESC) AS rn
              FROM distinct_bettors
            )
            SELECT event_id, username, side, avatar_url
            FROM ranked
            WHERE rn <= 6
            ORDER BY event_id, rn
          `,
          // DISTINCT ON (event_id) picks the single most recent top-level
          // (non-reply, non-deleted) comment per event in one pass.
          sql`
            SELECT DISTINCT ON (event_id) event_id, username, content
            FROM comments
            WHERE event_id = ANY(${eventIds as any}::text[])
              AND deleted_at IS NULL
              AND parent_id IS NULL
            ORDER BY event_id, timestamp DESC
          `,
        ]);

        const previewByEvent = new Map<string, { username: string; avatar_url?: string; side: string }[]>();
        for (const row of bettorPreviewResult.rows) {
          const list = previewByEvent.get(row.event_id) || [];
          list.push({ username: row.username, avatar_url: row.avatar_url || undefined, side: row.side });
          previewByEvent.set(row.event_id, list);
        }

        const MAX_COMMENT_PREVIEW_LENGTH = 140;
        const commentByEvent = new Map<string, { username: string; content: string }>();
        for (const row of latestCommentResult.rows) {
          const content: string = row.content || '';
          const trimmed = content.length > MAX_COMMENT_PREVIEW_LENGTH
            ? `${content.slice(0, MAX_COMMENT_PREVIEW_LENGTH).trimEnd()}…`
            : content;
          commentByEvent.set(row.event_id, { username: row.username, content: trimmed });
        }

        for (const event of events) {
          const preview = previewByEvent.get(event.id);
          if (preview && preview.length > 0) event.bettor_preview = preview;
          const comment = commentByEvent.get(event.id);
          if (comment) event.latest_comment = comment;
        }
      }

      return events;
    },
  },

  bets: {
    get: async (id: string): Promise<Bet | null> => {
      const result = await sql`SELECT * FROM bets WHERE id = ${id}`;
      if (result.rows.length === 0) return null;
      return mapBet(result.rows[0]);
    },

    getByEvent: async (event_id: string): Promise<Bet[]> => {
      const result = await sql`
        SELECT * FROM bets
        WHERE event_id = ${event_id}
        ORDER BY timestamp ASC
      `;
      return result.rows.map(mapBet);
    },

    getByUser: async (user_id: string): Promise<Bet[]> => {
      const result = await sql`
        SELECT * FROM bets
        WHERE user_id = ${user_id}
        ORDER BY timestamp DESC
      `;
      return result.rows.map(mapBet);
    },

    getAll: async (): Promise<Bet[]> => {
      const result = await sql`SELECT * FROM bets ORDER BY timestamp DESC`;
      return result.rows.map(mapBet);
    },

    create: async (bet: Bet): Promise<Bet> => {
      await sql`
        INSERT INTO bets (id, event_id, user_id, username, side, amount, note, is_late, timestamp, escrow_hold_id)
        VALUES (
          ${bet.id},
          ${bet.event_id},
          ${bet.user_id},
          ${bet.username},
          ${bet.side},
          ${bet.amount},
          ${bet.note || null},
          ${bet.is_late},
          ${bet.timestamp},
          ${bet.escrow_hold_id ?? null}
        )
      `;
      return bet;
    },

    delete: async (id: string): Promise<void> => {
      await sql`DELETE FROM bets WHERE id = ${id}`;
    },
  },
  
  activities: {
    getAll: async (): Promise<ActivityItem[]> => {
      const result = await sql`
        SELECT * 
        FROM activities
        ORDER BY timestamp DESC
        LIMIT 50
      `;
      
      return result.rows.map(row => ({
        type: row.type,
        event_id: row.event_id,
        event_title: row.event_title,
        user_id: row.user_id || undefined,
        username: row.username,
        side: row.side,
        amount: row.amount ? parseFloat(row.amount) : undefined,
        note: row.note || undefined,
        winning_side: row.winning_side,
        timestamp: parseInt(row.timestamp),
      }));
    },

    getByUserGroups: async (userId: string, limit: number = 50, offset: number = 0): Promise<ActivityItem[]> => {
      const result = await sql`
        SELECT
          a.*,
          e.group_id,
          g.name as group_name
        FROM activities a
        INNER JOIN events e ON a.event_id = e.id
        INNER JOIN groups g ON e.group_id = g.id
        INNER JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = ${userId}
          AND gm.status = 'active'
        ORDER BY a.timestamp DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      
      return result.rows.map(row => ({
        type: row.type,
        event_id: row.event_id,
        event_title: row.event_title,
        group_id: row.group_id,
        group_name: row.group_name,
        user_id: row.user_id || undefined,
        username: row.username,
        side: row.side,
        amount: row.amount ? parseFloat(row.amount) : undefined,
        note: row.note || undefined,
        winning_side: row.winning_side,
        timestamp: parseInt(row.timestamp),
      }));
    },
    
    add: async (activity: ActivityItem): Promise<ActivityItem> => {
      await sql`
        INSERT INTO activities (type, event_id, event_title, user_id, username, side, amount, note, winning_side, timestamp)
        VALUES (
          ${activity.type},
          ${activity.event_id},
          ${activity.event_title},
          ${activity.user_id || null},
          ${activity.username || null},
          ${activity.side || null},
          ${activity.amount || null},
          ${activity.note || null},
          ${activity.winning_side || null},
          ${activity.timestamp}
        )
      `;
      return activity;
    },
    
    deleteByBet: async (eventId: string, username: string, side: string, amount: number, timestamp: number): Promise<void> => {
      await sql`
        DELETE FROM activities 
        WHERE type = 'bet' 
          AND event_id = ${eventId} 
          AND LOWER(username) = LOWER(${username})
          AND side = ${side}
          AND amount = ${amount}
          AND timestamp = ${timestamp}
      `;
    },
  },

  pushSubscriptions: {
    getAll: async (): Promise<PushSubscription[]> => {
      const result = await sql`SELECT * FROM push_subscriptions`;
      return result.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        expo_token: row.expo_token,
        platform: row.platform,
      }));
    },

    getByUser: async (userId: string): Promise<PushSubscription[]> => {
      const result = await sql`
        SELECT * FROM push_subscriptions 
        WHERE user_id = ${userId}
      `;
      return result.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        expo_token: row.expo_token,
        platform: row.platform,
      }));
    },

    getByUserId: async (userId: string): Promise<PushSubscription[]> => {
      const result = await sql`
        SELECT * FROM push_subscriptions 
        WHERE user_id = ${userId}
      `;
      return result.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        expo_token: row.expo_token,
        platform: row.platform,
      }));
    },

    create: async (subscription: PushSubscription): Promise<PushSubscription> => {
      try {
        const result = await sql`
          INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, expo_token, platform)
          VALUES (
            ${subscription.user_id || null}, 
            ${subscription.endpoint}, 
            ${subscription.p256dh || null}, 
            ${subscription.auth || null},
            ${subscription.expo_token || null},
            ${subscription.platform || 'web'}
          )
          ON CONFLICT (endpoint) DO UPDATE 
          SET user_id = ${subscription.user_id || null}, 
              p256dh = ${subscription.p256dh || null}, 
              auth = ${subscription.auth || null},
              expo_token = ${subscription.expo_token || null},
              platform = ${subscription.platform || 'web'}
          RETURNING *
        `;
        const row = result.rows[0];
        return {
          id: row.id,
          user_id: row.user_id,
          endpoint: row.endpoint,
          p256dh: row.p256dh,
          auth: row.auth,
          expo_token: row.expo_token,
          platform: row.platform,
        };
      } catch (error) {
        console.error('Error creating push subscription:', error);
        throw error;
      }
    },

    delete: async (endpoint: string): Promise<void> => {
      await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
    },
  },

  groups: {
    get: async (id: string): Promise<Group | null> => {
      const result = await sql`SELECT * FROM groups WHERE id = ${id}`;
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        created_by: row.created_by,
        resolver_user_id: row.resolver_user_id || undefined,
        is_public: row.is_public || false,
        created_at: row.created_at,
      };
    },

    getAll: async (): Promise<Group[]> => {
      const result = await sql`SELECT * FROM groups ORDER BY created_at DESC`;
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        created_by: row.created_by,
        resolver_user_id: row.resolver_user_id || undefined,
        is_public: row.is_public || false,
        created_at: row.created_at,
      }));
    },

    getPublic: async (): Promise<Group[]> => {
      const result = await sql`
        SELECT * FROM groups 
        WHERE is_public = TRUE 
        ORDER BY created_at DESC
      `;
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        created_by: row.created_by,
        resolver_user_id: row.resolver_user_id || undefined,
        is_public: row.is_public || false,
        created_at: row.created_at,
      }));
    },

    getByUser: async (userId: string): Promise<Group[]> => {
      const result = await sql`
        SELECT g.* FROM groups g
        INNER JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = ${userId} AND gm.status = 'active'
        ORDER BY g.created_at DESC
      `;
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        created_by: row.created_by,
        resolver_user_id: row.resolver_user_id || undefined,
        is_public: row.is_public || false,
        created_at: row.created_at,
      }));
    },

    create: async (group: Group): Promise<Group> => {
      await sql`
        INSERT INTO groups (id, name, created_by, resolver_user_id, is_public)
        VALUES (${group.id}, ${group.name}, ${group.created_by}, ${group.resolver_user_id || group.created_by}, ${group.is_public || false})
      `;
      return group;
    },

    update: async (id: string, data: Partial<Group>): Promise<Group | null> => {
      if (data.name !== undefined) {
        await sql`UPDATE groups SET name = ${data.name} WHERE id = ${id}`;
      }
      if (data.resolver_user_id !== undefined) {
        await sql`UPDATE groups SET resolver_user_id = ${data.resolver_user_id} WHERE id = ${id}`;
      }
      if (data.is_public !== undefined) {
        await sql`UPDATE groups SET is_public = ${data.is_public} WHERE id = ${id}`;
      }
      return await db.groups.get(id);
    },

    delete: async (id: string): Promise<void> => {
      await sql`DELETE FROM groups WHERE id = ${id}`;
    },
  },

  groupMembers: {
    get: async (groupId: string, userId: string): Promise<GroupMember | null> => {
      const result = await sql`
        SELECT * FROM group_members 
        WHERE group_id = ${groupId} AND user_id = ${userId}
      `;
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        group_id: row.group_id,
        user_id: row.user_id,
        role: row.role,
        status: row.status,
        joined_at: row.joined_at,
      };
    },

    getByGroup: async (groupId: string): Promise<GroupMember[]> => {
      const result = await sql`
        SELECT gm.*, u.username FROM group_members gm
        INNER JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = ${groupId}
        ORDER BY 
          CASE WHEN gm.role = 'admin' THEN 0 ELSE 1 END,
          gm.joined_at ASC
      `;
      return result.rows.map(row => ({
        id: row.id,
        group_id: row.group_id,
        user_id: row.user_id,
        username: row.username,
        role: row.role,
        status: row.status,
        joined_at: row.joined_at,
      }));
    },

    getPendingByGroup: async (groupId: string): Promise<GroupMember[]> => {
      const result = await sql`
        SELECT gm.*, u.username FROM group_members gm
        INNER JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = ${groupId} AND gm.status = 'pending'
        ORDER BY gm.joined_at ASC
      `;
      return result.rows.map(row => ({
        id: row.id,
        group_id: row.group_id,
        user_id: row.user_id,
        username: row.username,
        role: row.role,
        status: row.status,
        joined_at: row.joined_at,
      }));
    },

    create: async (member: GroupMember): Promise<GroupMember> => {
      const result = await sql`
        INSERT INTO group_members (group_id, user_id, role, status)
        VALUES (${member.group_id}, ${member.user_id}, ${member.role}, ${member.status})
        RETURNING *
      `;
      const row = result.rows[0];
      return {
        id: row.id,
        group_id: row.group_id,
        user_id: row.user_id,
        role: row.role,
        status: row.status,
        joined_at: row.joined_at,
      };
    },

    update: async (groupId: string, userId: string, data: Partial<GroupMember>): Promise<GroupMember | null> => {
      if (data.role !== undefined) {
        await sql`
          UPDATE group_members 
          SET role = ${data.role} 
          WHERE group_id = ${groupId} AND user_id = ${userId}
        `;
      }
      if (data.status !== undefined) {
        await sql`
          UPDATE group_members 
          SET status = ${data.status} 
          WHERE group_id = ${groupId} AND user_id = ${userId}
        `;
      }
      return await db.groupMembers.get(groupId, userId);
    },

    delete: async (groupId: string, userId: string): Promise<void> => {
      await sql`
        DELETE FROM group_members 
        WHERE group_id = ${groupId} AND user_id = ${userId}
      `;
    },

    isAdmin: async (groupId: string, userId: string): Promise<boolean> => {
      const result = await sql`
        SELECT role FROM group_members 
        WHERE group_id = ${groupId} AND user_id = ${userId} AND status = 'active'
      `;
      return result.rows.length > 0 && result.rows[0].role === 'admin';
    },

    isMember: async (groupId: string, userId: string): Promise<boolean> => {
      const result = await sql`
        SELECT * FROM group_members 
        WHERE group_id = ${groupId} AND user_id = ${userId} AND status = 'active'
      `;
      return result.rows.length > 0;
    },
  },

  comments: {
    get: async (id: string): Promise<Comment | null> => {
      const result = await sql`SELECT * FROM comments WHERE id = ${id}`;
      if (result.rows.length === 0) return null;
      return mapComment(result.rows[0]);
    },

    // Excludes soft-deleted comments by default; pass { includeDeleted: true }
    // to see them (e.g. for moderation views).
    getByEvent: async (eventId: string, opts?: { includeDeleted?: boolean }): Promise<Comment[]> => {
      const result = opts?.includeDeleted
        ? await sql`
            SELECT * FROM comments
            WHERE event_id = ${eventId}
            ORDER BY timestamp ASC
          `
        : await sql`
            SELECT * FROM comments
            WHERE event_id = ${eventId} AND deleted_at IS NULL
            ORDER BY timestamp ASC
          `;
      return result.rows.map(mapComment);
    },

    getReplies: async (parentId: string): Promise<Comment[]> => {
      const result = await sql`
        SELECT * FROM comments
        WHERE parent_id = ${parentId} AND deleted_at IS NULL
        ORDER BY timestamp ASC
      `;
      return result.rows.map(mapComment);
    },

    // One query for the event's comments (top-level + replies, since replies
    // share the same event_id), plus exactly two batched lookups for
    // reactions and mentions across all of those comment ids — no N+1.
    // reply_count is derived in-memory from the same comments list.
    getThreadByEvent: async (eventId: string): Promise<CommentWithMeta[]> => {
      const comments = await db.comments.getByEvent(eventId);
      if (comments.length === 0) return [];

      const commentIds = comments.map(c => c.id);
      const [reactionsByComment, mentionsByComment] = await Promise.all([
        db.commentReactions.getByComments(commentIds),
        db.commentMentions.getByComments(commentIds),
      ]);

      const replyCounts = new Map<string, number>();
      for (const c of comments) {
        if (c.parent_id) {
          replyCounts.set(c.parent_id, (replyCounts.get(c.parent_id) || 0) + 1);
        }
      }

      return comments.map(c => ({
        ...c,
        reactions: reactionsByComment[c.id] || [],
        mention_user_ids: mentionsByComment[c.id] || [],
        reply_count: replyCounts.get(c.id) || 0,
      }));
    },

    create: async (comment: Comment): Promise<Comment> => {
      await sql`
        INSERT INTO comments (id, event_id, user_id, username, content, timestamp, parent_id)
        VALUES (
          ${comment.id},
          ${comment.event_id},
          ${comment.user_id},
          ${comment.username},
          ${comment.content},
          ${comment.timestamp},
          ${comment.parent_id ?? null}
        )
      `;
      return comment;
    },

    // Sets deleted_at but leaves the row so replies keep a valid parent_id.
    softDelete: async (id: string): Promise<Comment | null> => {
      await sql`UPDATE comments SET deleted_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
      return await db.comments.get(id);
    },

    updateContent: async (id: string, content: string): Promise<Comment | null> => {
      await sql`UPDATE comments SET content = ${content}, edited_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
      return await db.comments.get(id);
    },

    delete: async (id: string): Promise<void> => {
      await sql`DELETE FROM comments WHERE id = ${id}`;
    },
  },

  commentReactions: {
    getByComment: async (commentId: string): Promise<CommentReactionSummary[]> => {
      const result = await sql`
        SELECT emoji, user_id
        FROM comment_reactions
        WHERE comment_id = ${commentId}
        ORDER BY created_at ASC
      `;
      return summarizeReactions(result.rows);
    },

    // Batched lookup for many comments at once: Record<comment_id, CommentReactionSummary[]>.
    getByComments: async (commentIds: string[]): Promise<Record<string, CommentReactionSummary[]>> => {
      if (commentIds.length === 0) return {};
      const result = await sql`
        SELECT comment_id, emoji, user_id
        FROM comment_reactions
        WHERE comment_id = ANY(${commentIds as any}::text[])
        ORDER BY created_at ASC
      `;
      const byComment: Record<string, any[]> = {};
      for (const row of result.rows) {
        (byComment[row.comment_id] ||= []).push(row);
      }
      const out: Record<string, CommentReactionSummary[]> = {};
      for (const commentId of Object.keys(byComment)) {
        out[commentId] = summarizeReactions(byComment[commentId]);
      }
      return out;
    },

    add: async (commentId: string, userId: string, emoji: string): Promise<void> => {
      await sql`
        INSERT INTO comment_reactions (comment_id, user_id, emoji)
        VALUES (${commentId}, ${userId}, ${emoji})
        ON CONFLICT (comment_id, user_id, emoji) DO NOTHING
      `;
    },

    remove: async (commentId: string, userId: string, emoji: string): Promise<void> => {
      await sql`
        DELETE FROM comment_reactions
        WHERE comment_id = ${commentId} AND user_id = ${userId} AND emoji = ${emoji}
      `;
    },

    toggle: async (commentId: string, userId: string, emoji: string): Promise<{ added: boolean }> => {
      const existing = await sql`
        SELECT id FROM comment_reactions
        WHERE comment_id = ${commentId} AND user_id = ${userId} AND emoji = ${emoji}
      `;
      if (existing.rows.length > 0) {
        await db.commentReactions.remove(commentId, userId, emoji);
        return { added: false };
      }
      await db.commentReactions.add(commentId, userId, emoji);
      return { added: true };
    },
  },

  commentMentions: {
    getByComment: async (commentId: string): Promise<string[]> => {
      const result = await sql`
        SELECT mentioned_user_id FROM comment_mentions WHERE comment_id = ${commentId}
      `;
      return result.rows.map(row => row.mentioned_user_id);
    },

    // Batched lookup for many comments at once: Record<comment_id, mentioned_user_id[]>.
    getByComments: async (commentIds: string[]): Promise<Record<string, string[]>> => {
      if (commentIds.length === 0) return {};
      const result = await sql`
        SELECT comment_id, mentioned_user_id
        FROM comment_mentions
        WHERE comment_id = ANY(${commentIds as any}::text[])
      `;
      const out: Record<string, string[]> = {};
      for (const row of result.rows) {
        (out[row.comment_id] ||= []).push(row.mentioned_user_id);
      }
      return out;
    },

    createMany: async (commentId: string, mentionedUserIds: string[]): Promise<void> => {
      if (mentionedUserIds.length === 0) return;
      await Promise.all(
        mentionedUserIds.map(userId =>
          sql`
            INSERT INTO comment_mentions (comment_id, mentioned_user_id)
            VALUES (${commentId}, ${userId})
            ON CONFLICT (comment_id, mentioned_user_id) DO NOTHING
          `
        )
      );
    },

    getByUser: async (userId: string, limit: number = 50): Promise<CommentMention[]> => {
      const result = await sql`
        SELECT * FROM comment_mentions
        WHERE mentioned_user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return result.rows.map(row => ({
        id: row.id,
        comment_id: row.comment_id,
        mentioned_user_id: row.mentioned_user_id,
        created_at: row.created_at,
      }));
    },

    deleteByComment: async (commentId: string): Promise<void> => {
      await sql`DELETE FROM comment_mentions WHERE comment_id = ${commentId}`;
    },
  },

  wallets: {
    get: async (userId: string): Promise<Wallet | null> => {
      const result = await sql`SELECT * FROM wallets WHERE user_id = ${userId}`;
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        user_id: row.user_id,
        balance: parseFloat(row.balance),
        currency: row.currency,
        updated_at: row.updated_at,
      };
    },

    getOrCreate: async (userId: string): Promise<Wallet> => {
      const existing = await db.wallets.get(userId);
      if (existing) return existing;

      await sql`
        INSERT INTO wallets (user_id, balance, currency)
        VALUES (${userId}, 0, 'usd')
        ON CONFLICT (user_id) DO NOTHING
      `;
      const wallet = await db.wallets.get(userId);
      return wallet!;
    },

    updateBalance: async (userId: string, amount: number): Promise<Wallet | null> => {
      await sql`
        UPDATE wallets
        SET balance = balance + ${amount}, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ${userId}
      `;
      return await db.wallets.get(userId);
    },

    deductBalance: async (userId: string, amount: number): Promise<{ success: boolean; wallet: Wallet | null }> => {
      // Atomic deduction with balance check to prevent overdraft
      const result = await sql`
        UPDATE wallets
        SET balance = balance - ${amount}, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ${userId} AND balance >= ${amount}
        RETURNING *
      `;
      if (result.rows.length === 0) {
        const wallet = await db.wallets.get(userId);
        return { success: false, wallet };
      }
      const row = result.rows[0];
      return {
        success: true,
        wallet: {
          user_id: row.user_id,
          balance: parseFloat(row.balance),
          currency: row.currency,
          updated_at: row.updated_at,
        },
      };
    },
  },

  transactions: {
    get: async (id: string): Promise<Transaction | null> => {
      const result = await sql`SELECT * FROM transactions WHERE id = ${id}`;
      if (result.rows.length === 0) return null;
      return mapTransaction(result.rows[0]);
    },

    getByUser: async (userId: string, limit: number = 50, offset: number = 0): Promise<Transaction[]> => {
      const result = await sql`
        SELECT * FROM transactions
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      return result.rows.map(mapTransaction);
    },

    create: async (transaction: Transaction): Promise<Transaction> => {
      await sql`
        INSERT INTO transactions (id, user_id, type, amount, status, stripe_payment_intent_id, description, idempotency_key, event_id)
        VALUES (
          ${transaction.id},
          ${transaction.user_id},
          ${transaction.type},
          ${transaction.amount},
          ${transaction.status},
          ${transaction.stripe_payment_intent_id || null},
          ${transaction.description || null},
          ${transaction.idempotency_key ?? null},
          ${transaction.event_id ?? null}
        )
      `;
      return transaction;
    },

    updateStatus: async (id: string, status: string): Promise<void> => {
      await sql`UPDATE transactions SET status = ${status} WHERE id = ${id}`;
    },

    getByStripeId: async (stripeId: string): Promise<Transaction | null> => {
      const result = await sql`
        SELECT * FROM transactions WHERE stripe_payment_intent_id = ${stripeId}
      `;
      if (result.rows.length === 0) return null;
      return mapTransaction(result.rows[0]);
    },

    getByIdempotencyKey: async (idempotencyKey: string): Promise<Transaction | null> => {
      const result = await sql`
        SELECT * FROM transactions WHERE idempotency_key = ${idempotencyKey}
      `;
      if (result.rows.length === 0) return null;
      return mapTransaction(result.rows[0]);
    },
  },

  escrowHolds: {
    get: async (id: string): Promise<EscrowHold | null> => {
      const result = await sql`SELECT * FROM escrow_holds WHERE id = ${id}`;
      if (result.rows.length === 0) return null;
      return mapEscrowHold(result.rows[0]);
    },

    getByEvent: async (eventId: string): Promise<EscrowHold[]> => {
      const result = await sql`
        SELECT * FROM escrow_holds WHERE event_id = ${eventId} ORDER BY created_at ASC
      `;
      return result.rows.map(mapEscrowHold);
    },

    getByBet: async (betId: string): Promise<EscrowHold[]> => {
      const result = await sql`
        SELECT * FROM escrow_holds WHERE bet_id = ${betId} ORDER BY created_at ASC
      `;
      return result.rows.map(mapEscrowHold);
    },

    /**
     * Escrow status of every bet in one event, keyed by bet id. The ledger draws
     * an escrow chip on each cash bet, and getWalletSummary only ever returns
     * the caller's own holds — so the chip needs this event-wide view instead.
     * Only the status is returned: amount and owner are already on the bet.
     */
    getStatusByBetForEvent: async (eventId: string): Promise<Record<string, EscrowHoldStatus>> => {
      const result = await sql`
        SELECT bet_id, status FROM escrow_holds
        WHERE event_id = ${eventId} AND bet_id IS NOT NULL
        ORDER BY created_at ASC
      `;
      const statusByBet: Record<string, EscrowHoldStatus> = {};
      for (const row of result.rows) {
        statusByBet[row.bet_id] = row.status as EscrowHoldStatus;
      }
      return statusByBet;
    },

    getByUser: async (userId: string, status?: EscrowHoldStatus): Promise<EscrowHold[]> => {
      const result = status
        ? await sql`
            SELECT * FROM escrow_holds
            WHERE user_id = ${userId} AND status = ${status}
            ORDER BY created_at DESC
          `
        : await sql`
            SELECT * FROM escrow_holds
            WHERE user_id = ${userId}
            ORDER BY created_at DESC
          `;
      return result.rows.map(mapEscrowHold);
    },

    create: async (hold: EscrowHold): Promise<EscrowHold> => {
      await sql`
        INSERT INTO escrow_holds (id, event_id, bet_id, user_id, amount, status)
        VALUES (
          ${hold.id},
          ${hold.event_id},
          ${hold.bet_id ?? null},
          ${hold.user_id},
          ${hold.amount},
          ${hold.status || 'held'}
        )
      `;
      return hold;
    },

    // Only transitions rows currently in 'held' — the WHERE clause guards
    // against double-releasing/refunding a hold.
    markReleased: async (id: string): Promise<EscrowHold | null> => {
      const result = await sql`
        UPDATE escrow_holds
        SET status = 'released', released_at = CURRENT_TIMESTAMP
        WHERE id = ${id} AND status = 'held'
        RETURNING *
      `;
      if (result.rows.length === 0) return null;
      return mapEscrowHold(result.rows[0]);
    },

    markRefunded: async (id: string): Promise<EscrowHold | null> => {
      const result = await sql`
        UPDATE escrow_holds
        SET status = 'refunded', released_at = CURRENT_TIMESTAMP
        WHERE id = ${id} AND status = 'held'
        RETURNING *
      `;
      if (result.rows.length === 0) return null;
      return mapEscrowHold(result.rows[0]);
    },

    getHeldTotalForUser: async (userId: string): Promise<number> => {
      const result = await sql`
        SELECT COALESCE(SUM(amount), 0)::numeric as total
        FROM escrow_holds
        WHERE user_id = ${userId} AND status = 'held'
      `;
      return parseFloat(result.rows[0].total);
    },

    getHeldTotalForEvent: async (eventId: string): Promise<number> => {
      const result = await sql`
        SELECT COALESCE(SUM(amount), 0)::numeric as total
        FROM escrow_holds
        WHERE event_id = ${eventId} AND status = 'held'
      `;
      return parseFloat(result.rows[0].total);
    },
  },

  notificationPreferences: {
    get: async (userId: string): Promise<NotificationPreferences | null> => {
      const result = await sql`SELECT * FROM notification_preferences WHERE user_id = ${userId}`;
      if (result.rows.length === 0) return null;
      return mapNotificationPreferences(result.rows[0]);
    },

    getOrCreate: async (userId: string): Promise<NotificationPreferences> => {
      const existing = await db.notificationPreferences.get(userId);
      if (existing) return existing;

      await sql`
        INSERT INTO notification_preferences (user_id)
        VALUES (${userId})
        ON CONFLICT (user_id) DO NOTHING
      `;
      const prefs = await db.notificationPreferences.get(userId);
      return prefs!;
    },

    // Merges `categories` over the current/default categories so a partial
    // update never drops keys, and always bumps updated_at.
    upsert: async (userId: string, prefs: Partial<NotificationPreferences>): Promise<NotificationPreferences> => {
      const current = await db.notificationPreferences.get(userId);
      const mergedCategories: NotificationCategories = {
        ...DEFAULT_NOTIFICATION_CATEGORIES,
        ...(current?.categories || {}),
        ...(prefs.categories || {}),
      };
      const pushEnabled = prefs.push_enabled ?? current?.push_enabled ?? true;
      const emailEnabled = prefs.email_enabled ?? current?.email_enabled ?? false;

      await sql`
        INSERT INTO notification_preferences (user_id, push_enabled, email_enabled, categories, updated_at)
        VALUES (${userId}, ${pushEnabled}, ${emailEnabled}, ${JSON.stringify(mergedCategories)}, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) DO UPDATE
        SET push_enabled = ${pushEnabled},
            email_enabled = ${emailEnabled},
            categories = ${JSON.stringify(mergedCategories)},
            updated_at = CURRENT_TIMESTAMP
      `;
      const updated = await db.notificationPreferences.get(userId);
      return updated!;
    },

    getForUsers: async (userIds: string[]): Promise<Record<string, NotificationPreferences>> => {
      if (userIds.length === 0) return {};
      const result = await sql`
        SELECT * FROM notification_preferences WHERE user_id = ANY(${userIds as any}::text[])
      `;
      const out: Record<string, NotificationPreferences> = {};
      for (const row of result.rows) {
        const prefs = mapNotificationPreferences(row);
        out[prefs.user_id] = prefs;
      }
      return out;
    },

    isCategoryEnabled: async (
      userId: string,
      category: NotificationCategory,
      channel: 'push' | 'email'
    ): Promise<boolean> => {
      const prefs = await db.notificationPreferences.getOrCreate(userId);
      const channelEnabled = channel === 'push' ? prefs.push_enabled : prefs.email_enabled;
      return channelEnabled && prefs.categories[category];
    },
  },

  eventNotificationMutes: {
    get: async (eventId: string, userId: string): Promise<EventNotificationMute | null> => {
      const result = await sql`
        SELECT * FROM event_notification_mutes WHERE event_id = ${eventId} AND user_id = ${userId}
      `;
      if (result.rows.length === 0) return null;
      return mapEventNotificationMute(result.rows[0]);
    },

    getByEvent: async (eventId: string): Promise<EventNotificationMute[]> => {
      const result = await sql`SELECT * FROM event_notification_mutes WHERE event_id = ${eventId}`;
      return result.rows.map(mapEventNotificationMute);
    },

    getByUser: async (userId: string): Promise<EventNotificationMute[]> => {
      const result = await sql`SELECT * FROM event_notification_mutes WHERE user_id = ${userId}`;
      return result.rows.map(mapEventNotificationMute);
    },

    isMuted: async (eventId: string, userId: string): Promise<boolean> => {
      const result = await sql`
        SELECT 1 FROM event_notification_mutes WHERE event_id = ${eventId} AND user_id = ${userId}
      `;
      return result.rows.length > 0;
    },

    getMutedUserIds: async (eventId: string): Promise<string[]> => {
      const result = await sql`
        SELECT user_id FROM event_notification_mutes WHERE event_id = ${eventId}
      `;
      return result.rows.map(row => row.user_id);
    },

    create: async (mute: EventNotificationMute): Promise<EventNotificationMute> => {
      const result = await sql`
        INSERT INTO event_notification_mutes (event_id, user_id, reason)
        VALUES (${mute.event_id}, ${mute.user_id}, ${mute.reason || 'user_muted'})
        ON CONFLICT (event_id, user_id) DO UPDATE SET reason = EXCLUDED.reason
        RETURNING *
      `;
      return mapEventNotificationMute(result.rows[0]);
    },

    delete: async (eventId: string, userId: string): Promise<void> => {
      await sql`
        DELETE FROM event_notification_mutes WHERE event_id = ${eventId} AND user_id = ${userId}
      `;
    },
  },
};
