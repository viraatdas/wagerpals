// API service layer for backend communication
import {
  User,
  Group,
  Event,
  Bet,
  Comment,
  ActivityItem,
  GroupMember,
  EventWithStats,
  Wallet,
  Transaction,
  WalletSummary,
  NotificationPreferences,
  NotificationCategories,
  PaymentType,
} from '../types';
import authService from './auth';
import { getSharedItem } from './shared-session';
import { ApiError, toApiError } from '../utils/errors';

// Use the backend API URL - can be configured via environment
// @ts-ignore
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || (__DEV__
  ? 'http://localhost:3000'
  : 'https://www.wagerpals.io');

// Every request gets aborted after this many ms unless a call site overrides
// it — see `request()`'s `timeoutMs` option. 15s comfortably covers a cold
// serverless function start without leaving the user staring at a spinner
// forever on a dead connection (audit finding D7).
const DEFAULT_TIMEOUT_MS = 15000;

// Idempotent GETs get exactly one retry after a network/timeout failure, on
// the theory that a dropped packet or a slow cold-start is often transient.
// Mutations (POST/PATCH/DELETE) are never retried automatically — retrying a
// bet placement or a withdrawal on a timeout could double-submit it, and the
// server has no client-generated idempotency key for most of these routes.
const RETRY_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RequestOptions extends RequestInit {
  /** Per-call override for the abort deadline. Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /**
   * Opt-in response cache for GETs. When set, a hit within `ttlMs` is
   * returned immediately with no network call; a hit past `ttlMs` is
   * returned immediately too (stale-while-revalidate) while a background
   * refresh silently updates the cache for the next caller.
   *
   * Named `swr` rather than `cache` because RequestInit already declares a
   * `cache` field (the browser fetch cache mode, e.g. 'no-store') — reusing
   * that name would silently shadow it instead of adding a new option.
   */
  swr?: { ttlMs: number };
}

interface CacheEntry {
  data: unknown;
  at: number;
}

class ApiService {
  public API_BASE_URL = API_BASE_URL;

  // Keyed by `METHOD:url:body` — an identical request already in flight is
  // handed the same promise instead of firing a second network call. This is
  // what keeps e.g. two screens mounting at once (or a double-tap) from
  // racing duplicate fetches for the same data.
  private inFlight = new Map<string, Promise<unknown>>();

  // Keyed by `GET:endpoint`. Only populated for GETs whose caller opted in
  // via `{ swr: { ttlMs } }`.
  private cache = new Map<string, CacheEntry>();

  private getCached<T>(key: string): CacheEntry | undefined {
    return this.cache.get(key);
  }

  // Drops every cache entry whose key contains `prefix` — e.g.
  // `invalidate('/api/events')` clears both `/api/events?groupId=…` and
  // `/api/events?id=…` in one call. Mutating methods below call this for
  // every resource they can affect so a screen that re-reads right after a
  // write never sees stale cached data.
  invalidate(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  // Used on sign-out / account switch so the next signed-in user never sees
  // a screen briefly rendered from the previous user's cached responses.
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Drop the cached reads a screen owns so the NEXT read genuinely hits the
   * network. Pull-to-refresh handlers MUST call this before re-fetching.
   *
   * Why this is not optional: the SWR path below answers a repeat GET from
   * memory either way — a fresh entry is returned outright, and a stale one
   * is returned immediately while it revalidates in the background. So a
   * user who deliberately pulls to refresh inside the TTL (15s for groups,
   * 10s activity, 5s events) watches the spinner run and gets the exact same
   * bytes handed back. The gesture silently does nothing, which is worse
   * than having no pull-to-refresh at all, because it actively lies about
   * having checked.
   *
   * Mutations already invalidate the resources they touch; this exists
   * solely for user-initiated refreshes.
   */
  invalidateForRefresh(...prefixes: string[]): void {
    for (const prefix of prefixes) {
      this.invalidate(prefix);
    }
  }

  // Fire a request purely to warm the cache (e.g. a screen prefetching the
  // next likely screen's data). Errors are swallowed on purpose — a failed
  // prefetch must never surface as an unhandled promise rejection or an
  // error the user didn't ask to see; the real fetch, when it happens, will
  // surface its own error normally.
  prefetch(fn: () => Promise<unknown>): void {
    fn().catch(() => {});
  }

  // Performs one HTTP attempt: attaches auth headers, enforces the abort
  // timeout, and normalizes every failure mode into an ApiError. Retries
  // idempotent GETs once on a network/timeout failure before giving up.
  private async attempt<T>(
    endpoint: string,
    url: string,
    method: string,
    fetchOptions: RequestInit,
    timeoutMs: number,
    isRetry: boolean
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Access token + refresh token are read from the shared keychain on
      // every call rather than cached in memory, since either can change out
      // from under this service (sign-in/out in this process, or — for the
      // access token — a value written by the iMessage extension sharing the
      // same keychain access group).
      const [accessToken, refreshToken] = await Promise.all([
        authService.getAccessToken(),
        getSharedItem('refreshToken'),
      ]);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        // WHY this header exists (audit finding D9): lib/auth.ts's
        // resolveAuthenticatedStackUser reads `x-stack-refresh-token` and
        // passes both tokens to Stack Auth's `getUser({ tokenStore: {
        // accessToken, refreshToken } })`, which transparently mints a new
        // access token server-side when the one we sent has expired but the
        // refresh token is still valid. Sending this header on every
        // authenticated request IS the silent-refresh mechanism — there is
        // no separate client-callable refresh endpoint, and none should be
        // added. This also means we must never sign the user out just
        // because a single request came back 401: the 401 could simply mean
        // both tokens are gone, which is the only case sign-out is actually
        // warranted, but that decision belongs to the screen/session layer,
        // not to this transport.
        ...(refreshToken ? { 'x-stack-refresh-token': refreshToken } : {}),
        ...(fetchOptions.headers as Record<string, string> | undefined),
      };

      let response: Response;
      try {
        response = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
      } catch (err) {
        throw toApiError(err, endpoint);
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({} as { error?: string; code?: string }));
        throw new ApiError({
          message: body.error || `Request failed (${response.status})`,
          status: response.status,
          kind: 'http',
          endpoint,
          code: body.code,
        });
      }

      // A 204/empty body is valid for some mutations; guard against
      // `response.json()` throwing on an empty string.
      const text = await response.text();
      if (!text) {
        return undefined as unknown as T;
      }
      try {
        return JSON.parse(text) as T;
      } catch (err) {
        throw toApiError(err, endpoint);
      }
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : toApiError(err, endpoint);

      const canRetry = !isRetry && method === 'GET' && (apiErr.kind === 'network' || apiErr.kind === 'timeout');
      if (canRetry) {
        await delay(RETRY_DELAY_MS);
        return this.attempt<T>(endpoint, url, method, fetchOptions, timeoutMs, true);
      }

      // Log once, and only for failures that aren't plain "the user is
      // offline" — that case is already communicated to the user via
      // ApiError.userMessage and doesn't need console noise on every retry.
      if (apiErr.kind !== 'network') {
        console.warn(`[api] ${method} ${endpoint} failed:`, apiErr.kind, apiErr.status ?? '', apiErr.code ?? '', apiErr.message);
      }

      throw apiErr;
    } finally {
      clearTimeout(timer);
    }
  }

  // Wraps `attempt()` with in-flight de-duplication: an identical
  // (method + url + body) request already in progress is handed the same
  // promise instead of firing a second one.
  private dedupedFetch<T>(
    endpoint: string,
    url: string,
    method: string,
    fetchOptions: RequestInit,
    timeoutMs: number
  ): Promise<T> {
    const bodyKey = typeof fetchOptions.body === 'string' ? fetchOptions.body : '';
    const dedupeKey = `${method}:${url}:${bodyKey}`;

    const existing = this.inFlight.get(dedupeKey);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = this.attempt<T>(endpoint, url, method, fetchOptions, timeoutMs, false).finally(() => {
      this.inFlight.delete(dedupeKey);
    });

    this.inFlight.set(dedupeKey, promise);
    return promise;
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { timeoutMs, swr: swrOpt, ...fetchOptions } = options;
    const method = (fetchOptions.method || 'GET').toUpperCase();
    const url = `${API_BASE_URL}${endpoint}`;
    const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (method === 'GET' && swrOpt) {
      const cacheKey = `GET:${endpoint}`;
      const entry = this.getCached(cacheKey);

      if (entry) {
        const isFresh = Date.now() - entry.at < swrOpt.ttlMs;
        if (!isFresh) {
          // Stale-while-revalidate: the caller gets the stale value back
          // immediately below, while this refresh updates the cache in the
          // background for whoever asks next. Failures here are swallowed —
          // the caller already has a (stale but valid) answer.
          this.dedupedFetch<T>(endpoint, url, method, fetchOptions, effectiveTimeout)
            .then((data) => this.cache.set(cacheKey, { data, at: Date.now() }))
            .catch(() => {});
        }
        return entry.data as T;
      }

      const data = await this.dedupedFetch<T>(endpoint, url, method, fetchOptions, effectiveTimeout);
      this.cache.set(cacheKey, { data, at: Date.now() });
      return data;
    }

    return this.dedupedFetch<T>(endpoint, url, method, fetchOptions, effectiveTimeout);
  }

  // User APIs
  // Pure identity sync — call right after sign-in and on app resume. Never renames.
  async syncUser(): Promise<User> {
    return this.request<User>('/api/users', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  // Deliberate username choice by the human.
  async setUsername(username: string): Promise<User> {
    return this.request<User>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username, username_selected: true }),
    });
  }

  async getUser(id: string): Promise<User> {
    return this.request<User>(`/api/users?id=${encodeURIComponent(id)}`);
  }

  async getUserByUsername(username: string): Promise<User> {
    return this.request<User>(`/api/users?username=${encodeURIComponent(username)}`);
  }

  async getAllUsers(): Promise<User[]> {
    return this.request<User[]>('/api/users');
  }

  // Group APIs
  async getGroups(userId: string): Promise<Group[]> {
    return this.request<Group[]>(`/api/groups?userId=${encodeURIComponent(userId)}`, {
      swr: { ttlMs: 15000 },
    });
  }

  async getGroup(groupId: string): Promise<Group & { members?: GroupMember[]; pending_requests?: GroupMember[] }> {
    return this.request<Group & { members?: GroupMember[]; pending_requests?: GroupMember[] }>(
      `/api/groups?id=${encodeURIComponent(groupId)}`,
      { swr: { ttlMs: 15000 } }
    );
  }

  async createGroup(name: string, createdBy: string): Promise<Group> {
    const group = await this.request<Group>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name, created_by: createdBy }),
    });
    this.invalidate('/api/groups');
    return group;
  }

  async joinGroup(groupId: string, userId: string): Promise<{ message: string }> {
    const result = await this.request<{ message: string }>(`/api/groups/join`, {
      method: 'POST',
      body: JSON.stringify({ group_id: groupId, user_id: userId }),
    });
    this.invalidate('/api/groups');
    return result;
  }

  async getGroupMembers(groupId: string): Promise<GroupMember[]> {
    return this.request<GroupMember[]>(`/api/groups/members?groupId=${encodeURIComponent(groupId)}`);
  }

  // Flat-groups model: there's only one admin per group (the creator), so
  // promote/demote no longer exist as actions. approve/decline are kept
  // only to let a creator clear out any legacy 'pending' rows written
  // before joins-by-code became instantly active — new joins never produce
  // one, so most groups will never show these.
  async manageGroupMember(
    action: 'approve' | 'decline' | 'remove',
    groupId: string,
    adminUserId: string,
    targetUserId: string
  ): Promise<{ message: string }> {
    const result = await this.request<{ message: string }>('/api/groups/members', {
      method: 'POST',
      body: JSON.stringify({
        action,
        group_id: groupId,
        admin_user_id: adminUserId,
        target_user_id: targetUserId,
      }),
    });
    this.invalidate('/api/groups');
    return result;
  }

  async updateGroupSettings(input: {
    id: string;
    resolver_user_id?: string;
    is_public?: boolean;
    cash_enabled?: boolean;
    name?: string;
  }): Promise<Group> {
    const group = await this.request<Group>('/api/groups', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    this.invalidate('/api/groups');
    return group;
  }

  async deleteGroup(groupId: string): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>(`/api/groups?id=${encodeURIComponent(groupId)}`, {
      method: 'DELETE',
    });
    this.invalidate('/api/groups');
    // A deleted group's events/activity are gone too — their old cache
    // entries would otherwise keep serving events for a group that no
    // longer exists.
    this.invalidate('/api/events');
    this.invalidate('/api/activity');
    return result;
  }

  // GET /api/wallet?userId=&eventId= — the eventId leg is optional and adds
  // an event-scoped escrow summary (`WalletSummary.event`) to the response.
  // Never cached: balance/escrow figures are exactly the kind of data that
  // must never be shown stale.
  async getWallet(userId: string, eventId?: string): Promise<WalletSummary> {
    const params = new URLSearchParams({ userId });
    if (eventId) params.set('eventId', eventId);
    return this.request<WalletSummary>(`/api/wallet?${params.toString()}`);
  }

  // POST /api/wallet { action: 'deposit' } — creates a Stripe PaymentIntent
  // and a pending transaction row; the caller confirms payment client-side
  // with the returned clientSecret. idempotencyKey lets a retried tap (e.g.
  // after a timeout) avoid creating a second PaymentIntent for the same
  // attempt.
  async createDeposit(
    userId: string,
    amount: number,
    idempotencyKey?: string
  ): Promise<{ clientSecret: string; transaction: Transaction }> {
    const result = await this.request<{ clientSecret: string; transaction: Transaction }>('/api/wallet', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, action: 'deposit', amount, idempotency_key: idempotencyKey }),
    });
    this.invalidate('/api/wallet');
    return result;
  }

  // POST /api/wallet { action: 'withdraw' } — see lib/payments.ts
  // withdrawFromWallet for the exact success shape this mirrors:
  // { wallet, transaction, duplicate }. `duplicate: true` means this
  // idempotency_key was already used and the original transaction was
  // returned rather than a new withdrawal being made.
  async withdraw(
    userId: string,
    amount: number,
    idempotencyKey?: string
  ): Promise<{ wallet: Wallet; transaction: Transaction; duplicate: boolean }> {
    const result = await this.request<{ wallet: Wallet; transaction: Transaction; duplicate: boolean }>('/api/wallet', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, action: 'withdraw', amount, idempotency_key: idempotencyKey }),
    });
    this.invalidate('/api/wallet');
    return result;
  }

  // Event APIs
  async getEvents(groupId?: string): Promise<Event[]> {
    const query = groupId ? `?groupId=${encodeURIComponent(groupId)}` : '';
    // 5s matches the server's own `s-maxage=5` on this route (see
    // app/api/events/route.ts) so the client cache and the CDN/edge cache
    // agree on freshness.
    return this.request<Event[]>(`/api/events${query}`, { swr: { ttlMs: 5000 } });
  }

  async getEvent(id: string): Promise<EventWithStats> {
    return this.request<EventWithStats>(`/api/events?id=${encodeURIComponent(id)}`, {
      swr: { ttlMs: 5000 },
    });
  }

  // Audit finding D11 (client half): app/api/events/route.ts only enforces
  // group-membership on the creator, and only writes the `event_created`
  // activity feed row, `if (creator_user_id)` / `if (creator_username)`
  // respectively — both are silently optional server-side. Making them
  // required parameters here means a mobile call site physically cannot
  // create an event that's missing from the activity feed or that skips the
  // membership check.
  async createEvent(input: {
    title: string;
    description?: string;
    side_a: string;
    side_b: string;
    // No-expiry product rules: end_time is meaningless server-side now.
    // Optional so create screens can simply not send it — see
    // CreateEventScreen/CreateEventFromInviteScreen.
    end_time?: number;
    group_id: string;
    creator_user_id: string;
    creator_username: string;
    payment_type?: PaymentType;
    stake_amount?: number | null;
    subject_user_id?: string | null;
    notify_subject?: boolean;
  }): Promise<Event> {
    const event = await this.request<Event>('/api/events', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    this.invalidate('/api/events');
    this.invalidate('/api/activity');
    return event;
  }

  // Audit finding D3: app/api/events/resolve/route.ts reads `event_id` /
  // `winning_side` from the body — the old client sent `id` and always got a
  // 400. `action: 'cancel'` settles the event with a full refund instead of
  // picking a winner (winningSide is ignored server-side in that case).
  async resolveEvent(
    eventId: string,
    winningSide: string,
    action?: 'resolve' | 'cancel'
  ): Promise<Event & Record<string, unknown>> {
    const updated = await this.request<Event & Record<string, unknown>>(`/api/events/resolve`, {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, winning_side: winningSide, action }),
    });
    this.invalidate('/api/events');
    this.invalidate('/api/activity');
    this.invalidate('/api/wallet');
    return updated;
  }

  // Audit finding D4: app/api/events/unresolve/route.ts reads `event_id`,
  // not `id`.
  async unresolveEvent(eventId: string): Promise<Event & Record<string, unknown>> {
    const updated = await this.request<Event & Record<string, unknown>>(`/api/events/unresolve`, {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId }),
    });
    this.invalidate('/api/events');
    this.invalidate('/api/activity');
    this.invalidate('/api/wallet');
    return updated;
  }

  // Audit finding D4: app/api/events/delete/route.ts reads `event_id`, not
  // `id`. Note this is a POST, not a DELETE method — that's the real route
  // contract, not a mistake carried over from the old client.
  async deleteEvent(eventId: string): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>(`/api/events/delete`, {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId }),
    });
    this.invalidate('/api/events');
    this.invalidate('/api/activity');
    return result;
  }

  // Bet APIs
  async createBet(bet: {
    event_id: string;
    user_id: string;
    username: string;
    side: string;
    amount: number;
    note?: string;
  }): Promise<Bet> {
    const created = await this.request<Bet>('/api/bets', {
      method: 'POST',
      body: JSON.stringify(bet),
    });
    this.invalidate('/api/events');
    this.invalidate('/api/activity');
    this.invalidate('/api/wallet');
    return created;
  }

  async getBets(params: { event_id?: string; user_id?: string }): Promise<Bet[]> {
    const search = new URLSearchParams();
    if (params.event_id) search.set('event_id', params.event_id);
    if (params.user_id) search.set('user_id', params.user_id);
    const query = search.toString();
    return this.request<Bet[]>(`/api/bets${query ? `?${query}` : ''}`);
  }

  async deleteBet(betId: string): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>(`/api/bets?id=${encodeURIComponent(betId)}`, {
      method: 'DELETE',
    });
    this.invalidate('/api/events');
    this.invalidate('/api/activity');
    this.invalidate('/api/wallet');
    return result;
  }

  // Comment APIs
  async getComments(eventId: string): Promise<Comment[]> {
    return this.request<Comment[]>(`/api/comments?eventId=${encodeURIComponent(eventId)}`);
  }

  async createComment(comment: {
    event_id: string;
    user_id: string;
    username: string;
    content: string;
  }): Promise<Comment> {
    const created = await this.request<Comment>('/api/comments', {
      method: 'POST',
      body: JSON.stringify(comment),
    });
    this.invalidate('/api/comments');
    this.invalidate('/api/activity');
    return created;
  }

  // Activity APIs
  //
  // Audit finding D5: app/api/activity/route.ts requires `userId` and 400s
  // without it — the old client sent `groupId`, which the route doesn't even
  // read, so every call was a guaranteed failure. `userId` is now required
  // here too, with a clear client-side error instead of firing a request
  // that's certain to 400.
  async getActivity(userId: string, opts?: { limit?: number; offset?: number }): Promise<ActivityItem[]> {
    if (!userId) {
      throw new ApiError({
        message: 'getActivity requires a userId. /api/activity always 400s without one.',
        status: null,
        kind: 'http',
        endpoint: '/api/activity',
      });
    }

    const params = new URLSearchParams({ userId });
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.offset !== undefined) params.set('offset', String(opts.offset));

    // 10s matches the server's `s-maxage=10` on this route.
    return this.request<ActivityItem[]>(`/api/activity?${params.toString()}`, {
      swr: { ttlMs: 10000 },
    });
  }

  // Push notification APIs
  //
  // Sends a test notification to the SIGNED-IN user. /api/push/send-to-user
  // used to take a target userId from the body, which let any caller push
  // arbitrary text at any user; it was deleted. /api/push/test derives the
  // recipient and the copy from the session, so the input is ignored — the
  // parameter is kept so callers don't have to change.
  async sendPushToUser(_input?: {
    userId?: string;
    title?: string;
    body?: string;
    url?: string;
    eventId?: string;
    tag?: string;
  }): Promise<{ ok: boolean } | Record<string, unknown>> {
    return this.request('/api/push/test', { method: 'POST' });
  }
  async subscribeToPush(subscription: {
    token: string;
    userId?: string;
  }): Promise<{ success: boolean }> {
    return this.request('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    });
  }

  async unsubscribeFromPush(token: string): Promise<{ success: boolean }> {
    return this.request('/api/push/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ token }),
    });
  }

  // Notification preference APIs — identity comes from the session
  // (requireAuth reads the Authorization/refresh headers this service
  // already attaches to every request), so neither call takes a userId.
  async getNotificationPreferences(): Promise<NotificationPreferences> {
    return this.request<NotificationPreferences>('/api/push/preferences');
  }

  async updateNotificationPreferences(patch: {
    push_enabled?: boolean;
    email_enabled?: boolean;
    categories?: Partial<NotificationCategories>;
  }): Promise<NotificationPreferences> {
    const result = await this.request<NotificationPreferences>('/api/push/preferences', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    this.invalidate('/api/push/preferences');
    return result;
  }

  // ---- Waterfall-removal aggregators ----
  //
  // These exist so screens stop chaining sequential `await`s for data that
  // doesn't actually depend on each other — every leg below fires at once
  // via Promise.all/allSettled-equivalent handling instead of one request
  // waiting on the previous one to finish first.

  // Home screen: groups and activity are both independent of one another and
  // both required — if either fails, the whole call rejects with that
  // ApiError so the screen can show one error state instead of a partial one.
  async getHomeData(userId: string): Promise<{ groups: Group[]; activity: ActivityItem[] }> {
    if (!userId) {
      throw new ApiError({
        message: 'getHomeData requires a userId.',
        status: null,
        kind: 'http',
        endpoint: '/api/groups',
      });
    }
    const [groups, activity] = await Promise.all([this.getGroups(userId), this.getActivity(userId)]);
    return { groups, activity };
  }

  // Event detail screen: event + comments are required (a failure there
  // means the screen has nothing to show, so it should reject). The wallet
  // leg is optional context (used to show "you have $X available" next to
  // the bet form) and a signed-out user or a transient wallet failure must
  // not block the event from rendering — it degrades to `null` instead.
  async getEventScreenData(
    eventId: string,
    userId: string | null
  ): Promise<{ event: EventWithStats; comments: Comment[]; wallet: WalletSummary | null }> {
    const walletPromise: Promise<WalletSummary | null> = userId
      ? this.getWallet(userId, eventId).catch((err) => {
          const kind = err instanceof ApiError ? err.kind : 'unknown';
          console.warn(`[api] optional wallet leg of getEventScreenData(${eventId}) failed:`, kind);
          return null;
        })
      : Promise.resolve(null);

    const [event, comments, wallet] = await Promise.all([
      this.getEvent(eventId),
      this.getComments(eventId),
      walletPromise,
    ]);

    return { event, comments, wallet };
  }

  // Group detail screen: group info and its events are both required.
  async getGroupScreenData(
    groupId: string
  ): Promise<{ group: Group & { members?: GroupMember[]; pending_requests?: GroupMember[] }; events: Event[] }> {
    const [group, events] = await Promise.all([this.getGroup(groupId), this.getEvents(groupId)]);
    return { group, events };
  }
}

export default new ApiService();
