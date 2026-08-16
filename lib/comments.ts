// Shared, framework-free helpers for the comments feature.
//
// This module is ISOMORPHIC: it is imported both by a server route handler
// (app/api/comments/route.ts) and by 'use client' React components
// (components/CommentForm.tsx, components/CommentThread.tsx). It must never
// import 'server-only', 'next/*', '@/lib/db', a node builtin, or React —
// doing so would break the client bundle or the server route, respectively.
// Keep everything here pure and synchronous.

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const MAX_COMMENT_LENGTH = 2000;
export const MAX_COMMENT_DEPTH = 3; // renderable depths are 0, 1, 2
export const COMMENT_PAGE_SIZE = 20; // top-level roots fetched per page

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

export const ALLOWED_REACTION_EMOJI: readonly string[] = ['👍', '🔥', '😂', '😮', '😢', '🎉'];

export function isAllowedReaction(emoji: unknown): boolean {
  return typeof emoji === 'string' && ALLOWED_REACTION_EMOJI.includes(emoji);
}

// ---------------------------------------------------------------------------
// Content validation
// ---------------------------------------------------------------------------

export interface CommentValidation {
  valid: boolean;
  error?: string;
  value?: string;
}

export function validateCommentContent(raw: unknown): CommentValidation {
  if (typeof raw !== 'string') {
    return { valid: false, error: 'Comment must be text' };
  }

  // Normalise line endings before trimming so trailing \r\n on one platform
  // doesn't behave differently from \n on another.
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  if (normalized.length === 0) {
    return { valid: false, error: 'Comment cannot be empty' };
  }

  // Count in code points (Array.from), not UTF-16 code units, so a single
  // emoji/surrogate-pair character counts as one character, not two.
  if (Array.from(normalized).length > MAX_COMMENT_LENGTH) {
    return { valid: false, error: `Comment is too long (max ${MAX_COMMENT_LENGTH} characters)` };
  }

  // Collapse "wall of blank lines" spam down to a single blank line's worth
  // of visual separation (two newlines) without rejecting the comment.
  const collapsed = normalized.replace(/\n{3,}/g, '\n\n');

  return { valid: true, value: collapsed };
}

// ---------------------------------------------------------------------------
// @mentions
// ---------------------------------------------------------------------------

// A mention is `@` + 2..20 word chars, where the `@` sits at the very start
// of the string or is preceded by whitespace or one of ( [ { " ' , : ; -
// The boundary is a CONSUMED capture group rather than a lookbehind on
// purpose: this regex literal is evaluated at module load in a client bundle,
// and lookbehind is a parse error (not a runtime miss) on Safari < 16.4 —
// which would take the whole page down, not just mentions. Callers must skip
// past match[1] to find where the '@' actually starts. Two mentions can never
// share a boundary character, so consuming it loses no match.
// The trailing negative lookahead stops `@bobsmith2024plusmore` from matching
// a truncated 20-char prefix — a run of 21+ word chars simply doesn't match at
// all, rather than mangling a longer handle into a shorter mention.
const MENTION_RE = /(^|[\s([{"',:;-])@([A-Za-z0-9_]{2,20})(?![A-Za-z0-9_])/g;

const MAX_MENTIONS_PER_COMMENT = 20;

export function parseMentionUsernames(content: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of Array.from(content.matchAll(MENTION_RE))) {
    const lower = match[2].toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      out.push(lower);
      if (out.length >= MAX_MENTIONS_PER_COMMENT) break;
    }
  }
  return out;
}

export interface CommentSegment {
  type: 'text' | 'mention';
  value: string;
  userId?: string;
}

export function segmentCommentContent(
  content: string,
  resolve?: (usernameLower: string) => string | undefined
): CommentSegment[] {
  const segments: CommentSegment[] = [];
  let lastIndex = 0;

  for (const match of Array.from(content.matchAll(MENTION_RE))) {
    // match[1] is the consumed boundary character (or '' at string start), so
    // the mention itself starts after it — that boundary stays in the text run.
    const start = (match.index ?? 0) + match[1].length;
    if (start > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, start) });
    }

    const raw = `@${match[2]}`; // the literal '@name' as typed, e.g. '@Bob'
    const usernameLower = match[2].toLowerCase();
    const userId = resolve ? resolve(usernameLower) : undefined;

    // Only set userId when it resolves to something truthy — an unresolved
    // mention is still rendered as a (styled) mention segment by the
    // caller, just without a link/id attached.
    segments.push(userId ? { type: 'mention', value: raw, userId } : { type: 'mention', value: raw });

    lastIndex = start + raw.length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) });
  }

  // Degenerate case: no mentions and no trailing text (empty content) still
  // needs a segment array whose values concatenate back to `content`.
  if (segments.length === 0) {
    segments.push({ type: 'text', value: content });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Thread depth
// ---------------------------------------------------------------------------

const MAX_WALK_HOPS = 32;

export function commentDepth(commentId: string, parentById: Map<string, string | null | undefined>): number {
  let depth = 0;
  let current = commentId;

  for (let hops = 0; hops < MAX_WALK_HOPS; hops++) {
    if (!parentById.has(current)) return depth; // unknown id -> treat as root
    const parent = parentById.get(current);
    if (!parent) return depth; // no parent recorded -> this is a root
    if (!parentById.has(parent)) return depth; // dangling parent reference -> treat current as root
    current = parent;
    depth++;
  }

  // Cyclic chain: never found a root within the hop budget. Return the hop
  // count reached rather than looping forever.
  return depth;
}

export function resolveParentId(
  requestedParentId: string | null | undefined,
  parentById: Map<string, string | null | undefined>
): string | null {
  if (!requestedParentId) return null;
  if (!parentById.has(requestedParentId)) return null;

  let current = requestedParentId;
  for (let hops = 0; hops < MAX_WALK_HOPS; hops++) {
    if (commentDepth(current, parentById) <= MAX_COMMENT_DEPTH - 2) {
      return current;
    }
    const parent = parentById.get(current);
    if (!parent || !parentById.has(parent)) {
      // No further ancestor to climb to (shouldn't normally happen once the
      // depth check above holds, but guards a dangling/cyclic map).
      return current;
    }
    current = parent;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

export interface CommentNode<T> {
  comment: T;
  children: CommentNode<T>[];
  depth: number;
}

function compareByTimestampThenId(a: { id: string; timestamp: number }, b: { id: string; timestamp: number }): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function buildCommentTree<T extends { id: string; parent_id?: string | null; timestamp: number }>(
  comments: T[]
): CommentNode<T>[] {
  const byId = new Map<string, T>();
  for (const c of comments) byId.set(c.id, c);

  const childrenOf = new Map<string, T[]>();
  const rootCandidates: T[] = [];

  for (const c of comments) {
    const pid = c.parent_id;
    // A page of a thread never drops a comment: if the parent isn't in this
    // set (not present, or absent entirely), the comment surfaces as a root.
    if (pid && byId.has(pid)) {
      const arr = childrenOf.get(pid);
      if (arr) arr.push(c);
      else childrenOf.set(pid, [c]);
    } else {
      rootCandidates.push(c);
    }
  }

  for (const arr of Array.from(childrenOf.values())) arr.sort(compareByTimestampThenId);

  const visited = new Set<string>();

  function build(c: T, depth: number): CommentNode<T> {
    visited.add(c.id);
    const kids = childrenOf.get(c.id) ?? [];
    const children: CommentNode<T>[] = [];
    for (const k of kids) {
      // Guards a cyclic parent chain: once a node has been placed, it is
      // never re-entered, so a cycle simply stops growing instead of
      // recursing forever or appearing twice in the tree.
      if (visited.has(k.id)) continue;
      children.push(build(k, depth + 1));
    }
    return { comment: c, depth: Math.min(depth, MAX_COMMENT_DEPTH - 1), children };
  }

  const roots = rootCandidates.slice().sort(compareByTimestampThenId).map((r) => build(r, 0));

  // Any comment not reached from a real root belongs to a cycle with no
  // external entry point (every member of it has an existing parent within
  // the set). Surface the first such node, in stable order, as a synthetic
  // root so it isn't silently dropped; the `visited` guard above still
  // prevents it (or anything under it) from being duplicated.
  const leftover = comments.filter((c) => !visited.has(c.id)).sort(compareByTimestampThenId);
  for (const c of leftover) {
    if (visited.has(c.id)) continue;
    roots.push(build(c, 0));
  }

  return roots;
}

export function countReplies<T extends { id: string; parent_id?: string | null }>(comments: T[], rootId: string): number {
  const byParent = new Map<string, T[]>();
  for (const c of comments) {
    if (c.parent_id) {
      const arr = byParent.get(c.parent_id);
      if (arr) arr.push(c);
      else byParent.set(c.parent_id, [c]);
    }
  }

  let count = 0;
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const kids = byParent.get(current) ?? [];
    for (const k of kids) {
      if (visited.has(k.id)) continue; // cycle guard
      visited.add(k.id);
      count++;
      queue.push(k.id);
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
//
// A per-process, in-memory sliding-window limiter. This is a cheap abuse
// brake against comment-spam bursts, NOT a distributed rate limiter: each
// server process/instance keeps its own independent state, so a user
// bouncing between instances (or a redeploy/restart) resets their window.
// That tradeoff is fine for slowing down a single abusive burst; anything
// that needs to be authoritative across instances belongs in a shared store
// (e.g. Redis), which is out of scope here.

const BURST_LIMIT = 5;
const BURST_WINDOW_MS = 20_000;
const SUSTAINED_LIMIT = 20;
const SUSTAINED_WINDOW_MS = 300_000;

const postTimestamps = new Map<string, number[]>();

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export function checkCommentRateLimit(userId: string, now: number = Date.now()): RateLimitDecision {
  const existing = postTimestamps.get(userId) ?? [];
  // Prune to the larger (sustained) window; this also bounds the burst check.
  const recent = existing.filter((t) => now - t < SUSTAINED_WINDOW_MS);

  const burstEntries = recent.filter((t) => now - t < BURST_WINDOW_MS);

  let allowed = true;
  let retryAfterMs = 0;

  if (burstEntries.length >= BURST_LIMIT) {
    allowed = false;
    const oldest = Math.min(...burstEntries);
    retryAfterMs = Math.max(1, BURST_WINDOW_MS - (now - oldest));
  } else if (recent.length >= SUSTAINED_LIMIT) {
    allowed = false;
    const oldest = Math.min(...recent);
    retryAfterMs = Math.max(1, SUSTAINED_WINDOW_MS - (now - oldest));
  } else {
    // Only record the attempt when it's actually allowed through.
    recent.push(now);
  }

  // Keep the map pruned of empty entries so it can't grow unbounded across
  // the process lifetime as users come and go.
  if (recent.length === 0) {
    postTimestamps.delete(userId);
  } else {
    postTimestamps.set(userId, recent);
  }

  return { allowed, retryAfterMs };
}

export function resetCommentRateLimit(userId?: string): void {
  if (userId) {
    postTimestamps.delete(userId);
  } else {
    postTimestamps.clear();
  }
}

// ---------------------------------------------------------------------------
// Relative time formatting
// ---------------------------------------------------------------------------

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  if (!Number.isFinite(timestamp)) return '';

  const diffMs = Math.max(0, now - timestamp); // future timestamps clamp to 'just now'

  // Under a minute is 'just now' — anything less would floor to '0m ago'.
  const seconds = diffMs / 1000;
  if (seconds < 60) return 'just now';

  const minutes = diffMs / 60_000;
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;

  const hours = diffMs / 3_600_000;
  if (hours < 24) return `${Math.floor(hours)}h ago`;

  const days = diffMs / 86_400_000;
  if (days < 7) return `${Math.floor(days)}d ago`;

  const date = new Date(timestamp);
  const nowDate = new Date(now);
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (date.getFullYear() !== nowDate.getFullYear()) {
    return `${formatted}, ${date.getFullYear()}`;
  }
  return formatted;
}
