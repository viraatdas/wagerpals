'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { CommentWithMeta, CommentReactionSummary } from '@/lib/types';
import {
  MAX_COMMENT_LENGTH,
  MAX_COMMENT_DEPTH,
  COMMENT_PAGE_SIZE,
  ALLOWED_REACTION_EMOJI,
  segmentCommentContent,
  buildCommentTree,
  formatRelativeTime,
  type CommentNode,
} from '@/lib/comments';
import CommentForm, { type MentionMember } from '@/components/CommentForm';
import ConfirmationModal from '@/components/ConfirmationModal';
import Toast, { type ToastType } from '@/components/Toast';

export interface CommentThreadProps {
  eventId: string;
  currentUserId?: string;
  currentUsername?: string;
  canComment?: boolean;
  onCountChange?: (count: number) => void;
}

interface Viewer {
  user_id: string;
  is_group_admin: boolean;
}

interface CommentsListResponse {
  comments: CommentWithMeta[];
  members: MentionMember[];
  viewer: Viewer;
  total_count: number;
  has_more: boolean;
  next_before: number | null;
}

interface ToastState {
  message: string;
  type: ToastType;
}

// Static Tailwind class lookup — indentation cannot grow past a renderable
// depth of MAX_COMMENT_DEPTH - 1 (0, 1, 2). Tailwind statically scans source
// for class names, so these must be literal strings, never built at runtime.
const DEPTH_INDENT_CLASSES = [
  '',
  'ml-3 sm:ml-6 pl-3 border-l-2 border-gray-200',
  'ml-3 sm:ml-6 pl-3 border-l-2 border-gray-200',
];

function depthClass(depth: number): string {
  const idx = Math.min(depth, MAX_COMMENT_DEPTH - 1, DEPTH_INDENT_CLASSES.length - 1);
  return DEPTH_INDENT_CLASSES[Math.max(0, idx)];
}

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractErrorMessage(res: Response, data: any): string {
  if (res.status === 429) {
    const retryMs = typeof data?.retry_after_ms === 'number' ? data.retry_after_ms : undefined;
    const seconds = retryMs != null ? Math.max(1, Math.ceil(retryMs / 1000)) : undefined;
    return seconds != null
      ? `You're commenting too fast — try again in ${seconds}s`
      : "You're commenting too fast — try again in a moment";
  }
  if (data && typeof data.error === 'string' && data.error.trim()) return data.error;
  return `Something went wrong (${res.status})`;
}

function countDescendants(node: CommentNode<CommentWithMeta>): number {
  let count = 0;
  for (const child of node.children) {
    count += 1 + countDescendants(child);
  }
  return count;
}

function reactorNames(userIds: string[], memberById: Map<string, MentionMember>): { shown: string[]; extra: number } {
  const shown = userIds.slice(0, 8).map((id) => memberById.get(id)?.username ?? 'Someone');
  const extra = Math.max(0, userIds.length - 8);
  return { shown, extra };
}

// Bag of shared, read-only state + stable callbacks threaded down through the
// recursive tree. Kept as a single object (rather than a long prop list) so
// each CommentNodeItem only needs two props.
interface ThreadActions {
  currentUserId?: string;
  viewer: Viewer | null;
  canWrite: boolean;
  members: MentionMember[];
  memberById: Map<string, MentionMember>;
  resolveMemberIdByUsername: (usernameLower: string) => string | undefined;
  now: number;
  pendingIds: Set<string>;
  collapsedIds: Set<string>;
  toggleCollapse: (id: string) => void;
  expandedChildrenIds: Set<string>;
  expandChildren: (id: string) => void;
  replyOpenId: string | null;
  openReply: (id: string) => void;
  closeReply: () => void;
  submitReply: (parentId: string, content: string) => Promise<void>;
  editOpenId: string | null;
  openEdit: (id: string) => void;
  closeEdit: () => void;
  submitEdit: (comment: CommentWithMeta, content: string) => Promise<void>;
  deletingIds: Set<string>;
  requestDelete: (comment: CommentWithMeta) => void;
  reactionInFlight: Set<string>;
  toggleReaction: (comment: CommentWithMeta, emoji: string) => void;
  reactionPickerOpenId: string | null;
  openReactionPicker: (id: string) => void;
  closeReactionPicker: () => void;
  reactionPanelKey: string | null;
  toggleReactionPanel: (key: string) => void;
  pickerRef: RefObject<HTMLDivElement>;
}

function ReactionRow({ comment, actions }: { comment: CommentWithMeta; actions: ThreadActions }) {
  const isPickerOpen = actions.reactionPickerOpenId === comment.id;
  const visibleReactions = comment.reactions.filter((r) => r.count > 0);

  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-2">
      {visibleReactions.map((r: CommentReactionSummary) => {
        const key = `${comment.id}:${r.emoji}`;
        const isActive = !!actions.currentUserId && r.user_ids.includes(actions.currentUserId);
        const isPanelOpen = actions.reactionPanelKey === key;
        const isBusy = actions.reactionInFlight.has(key);
        const { shown, extra } = reactorNames(r.user_ids, actions.memberById);
        const namesText = shown.join(', ') + (extra > 0 ? `, +${extra} more` : '');

        return (
          <div key={r.emoji} className="relative">
            <button
              type="button"
              disabled={!actions.canWrite || isBusy}
              title={namesText || 'No reactions yet'}
              aria-label={`${r.emoji} reaction, ${r.count} ${r.count === 1 ? 'person' : 'people'}${namesText ? `: ${namesText}` : ''}`}
              className={`chip transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                isActive ? 'border-brand-2 text-brand-2 bg-brand-2/5' : ''
              }`}
              onClick={() => actions.toggleReaction(comment, r.emoji)}
            >
              <span aria-hidden="true">{r.emoji}</span>
              <span className="tabular-nums">{r.count}</span>
            </button>

            {/* Separate, always-enabled affordance: the chip itself is a pure
                toggle (clicking it must never also open a panel), and `title`
                is unreachable on touch — so who-reacted gets its own control,
                which read-only viewers can use too. */}
            <button
              type="button"
              aria-label={`Who reacted with ${r.emoji}${namesText ? `: ${namesText}` : ''}`}
              aria-expanded={isPanelOpen}
              className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-background-2 border border-gray-200 text-[8px] leading-none text-muted-2 hover:text-brand-2 flex items-center justify-center"
              onClick={() => actions.toggleReactionPanel(key)}
            >
              <span aria-hidden="true">?</span>
            </button>

            {isPanelOpen && (
              <div className="absolute z-10 top-full left-0 mt-1 glass-strong rounded-xl px-3 py-2 text-xs text-muted min-w-[140px] shadow-elev-3">
                {shown.length > 0 ? (
                  <ul>
                    {shown.map((name, i) => (
                      <li key={i}>{name}</li>
                    ))}
                    {extra > 0 && <li className="text-muted-2">+{extra} more</li>}
                  </ul>
                ) : (
                  <span>No reactions yet</span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {actions.canWrite && (
        <div className="relative" ref={isPickerOpen ? actions.pickerRef : undefined}>
          <button
            type="button"
            aria-label="Add reaction"
            aria-haspopup="menu"
            aria-expanded={isPickerOpen}
            className="chip"
            onClick={() => (isPickerOpen ? actions.closeReactionPicker() : actions.openReactionPicker(comment.id))}
          >
            <span aria-hidden="true">+</span>
          </button>

          {isPickerOpen && (
            <div
              role="menu"
              className="absolute z-10 top-full left-0 mt-1 glass-strong rounded-xl p-1.5 flex gap-1 shadow-elev-3"
            >
              {ALLOWED_REACTION_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  aria-label={`React with ${emoji}`}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-2 text-lg"
                  onClick={() => {
                    actions.toggleReaction(comment, emoji);
                    actions.closeReactionPicker();
                  }}
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CommentNodeItem({ node, actions }: { node: CommentNode<CommentWithMeta>; actions: ThreadActions }) {
  const { comment, depth, children } = node;
  const isRoot = depth === 0;
  const isDeleted = !!comment.deleted_at;
  const isPending = actions.pendingIds.has(comment.id);
  const isCollapsed = isRoot && actions.collapsedIds.has(comment.id);
  const descendantCount = isRoot ? countDescendants(node) : 0;
  const isAuthor = !!actions.currentUserId && actions.currentUserId === comment.user_id;
  const canEdit = actions.canWrite && !isDeleted && isAuthor;
  const canDelete = actions.canWrite && !isDeleted && (isAuthor || !!actions.viewer?.is_group_admin);
  const canReply = actions.canWrite && !isDeleted;
  const isReplyOpen = !isDeleted && actions.replyOpenId === comment.id;
  const isEditOpen = !isDeleted && actions.editOpenId === comment.id;
  const isDeleting = actions.deletingIds.has(comment.id);

  const segments = isDeleted ? [] : segmentCommentContent(comment.content, actions.resolveMemberIdByUsername);

  const showLimited = isRoot && children.length > 3 && !actions.expandedChildrenIds.has(comment.id);
  const visibleChildren = showLimited ? children.slice(-3) : children;
  const hiddenCount = showLimited ? children.length - visibleChildren.length : 0;

  return (
    <li className={`${depthClass(depth)} list-none`}>
      <div className={`glass rounded-2xl p-3 sm:p-4 transition-opacity ${isPending ? 'opacity-60' : ''}`}>
        {isDeleted ? (
          <p className="text-sm text-muted-2 italic">Comment deleted</p>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-foreground break-all text-sm">@{comment.username}</span>
              <time
                dateTime={new Date(comment.timestamp).toISOString()}
                title={new Date(comment.timestamp).toLocaleString()}
                className="text-xs text-muted-2 tabular-nums"
              >
                {formatRelativeTime(comment.timestamp, actions.now)}
              </time>
              {comment.edited_at && <span className="text-xs text-muted-2">(edited)</span>}
              {isPending && <span className="chip">Sending…</span>}
            </div>

            {isEditOpen ? (
              <CommentForm
                members={actions.members}
                initialContent={comment.content}
                submitLabel="Save"
                pendingLabel="Saving…"
                compact
                autoFocus
                maxLength={MAX_COMMENT_LENGTH}
                onSubmit={(content) => actions.submitEdit(comment, content)}
                onCancel={actions.closeEdit}
              />
            ) : (
              <p className="text-sm text-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {segments.map((seg, i) =>
                  seg.type === 'mention' ? (
                    <span key={i} className="text-brand-2 font-medium" title={seg.value}>
                      {seg.value}
                    </span>
                  ) : (
                    <span key={i}>{seg.value}</span>
                  )
                )}
              </p>
            )}

            {!isPending && <ReactionRow comment={comment} actions={actions} />}

            {!isPending && !isEditOpen && (canReply || canEdit || canDelete) && (
              <div className="flex items-center gap-3 mt-2">
                {canReply && (
                  <button
                    type="button"
                    className="text-xs text-muted-2 hover:text-brand-2 font-medium"
                    onClick={() => actions.openReply(comment.id)}
                  >
                    Reply
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className="text-xs text-muted-2 hover:text-brand-2 font-medium"
                    onClick={() => actions.openEdit(comment.id)}
                  >
                    Edit
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    disabled={isDeleting}
                    className="text-xs text-muted-2 hover:text-red-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => actions.requestDelete(comment)}
                  >
                    {isDeleting ? 'Deleting…' : 'Delete'}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {isReplyOpen && (
          <div className="mt-3">
            <CommentForm
              members={actions.members}
              submitLabel="Reply"
              pendingLabel="Replying…"
              placeholder={`Reply to @${comment.username}…`}
              compact
              autoFocus
              maxLength={MAX_COMMENT_LENGTH}
              onSubmit={(content) => actions.submitReply(comment.id, content)}
              onCancel={actions.closeReply}
            />
          </div>
        )}

        {isRoot && descendantCount > 0 && (
          <div className={isDeleted ? 'mt-1' : 'mt-2'}>
            <button
              type="button"
              aria-expanded={!isCollapsed}
              className="text-xs text-muted-2 hover:text-brand-2 font-medium"
              onClick={() => actions.toggleCollapse(comment.id)}
            >
              {isCollapsed
                ? `${descendantCount} ${descendantCount === 1 ? 'reply' : 'replies'}`
                : 'Hide replies'}
            </button>
          </div>
        )}
      </div>

      {children.length > 0 && !isCollapsed && (
        <ul className="mt-2 space-y-2">
          {visibleChildren.map((child) => (
            <CommentNodeItem key={child.comment.id} node={child} actions={actions} />
          ))}
          {hiddenCount > 0 && (
            <li className={`${depthClass(depth + 1)} list-none`}>
              <button
                type="button"
                className="text-xs text-brand-2 hover:underline font-medium"
                onClick={() => actions.expandChildren(comment.id)}
              >
                Show all {children.length} replies
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export default function CommentThread({
  eventId,
  currentUserId,
  currentUsername,
  canComment,
  onCountChange,
}: CommentThreadProps) {
  const [comments, setComments] = useState<CommentWithMeta[]>([]);
  const [members, setMembers] = useState<MentionMember[]>([]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [autoLoadArmed, setAutoLoadArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [expandedChildrenIds, setExpandedChildrenIds] = useState<Set<string>>(new Set());
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null);
  const [editOpenId, setEditOpenId] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<CommentWithMeta | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [reactionInFlight, setReactionInFlight] = useState<Set<string>>(new Set());
  const [reactionPickerOpenId, setReactionPickerOpenId] = useState<string | null>(null);
  const [reactionPanelKey, setReactionPanelKey] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [now, setNow] = useState<number>(() => Date.now());

  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const tempCounterRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const canWrite = !!currentUserId && (canComment ?? true);

  // One ticking clock for the whole thread — relative timestamps stay fresh
  // without a per-comment interval.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const fetchComments = useCallback(
    async (opts: { before?: number; append?: boolean } = {}) => {
      const { before, append } = opts;
      const myRequestId = ++requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          eventId,
          view: 'thread',
          limit: String(COMMENT_PAGE_SIZE),
        });
        if (before != null) params.set('before', String(before));

        const res = await fetch(`/api/comments?${params.toString()}`, { signal: controller.signal });
        const data = await safeJson(res);
        if (myRequestId !== requestIdRef.current) return; // superseded by a newer request

        if (!res.ok) {
          throw new Error(extractErrorMessage(res, data));
        }

        const payload = data as CommentsListResponse;
        setMembers(payload.members ?? []);
        setViewer(payload.viewer ?? null);
        setTotalCount(payload.total_count ?? 0);
        setHasMore(!!payload.has_more);
        setNextBefore(payload.next_before ?? null);

        setComments((prev) => {
          const merged = new Map<string, CommentWithMeta>();
          if (append) {
            // Older page goes first so it renders above what's already loaded.
            for (const c of payload.comments) merged.set(c.id, c);
            for (const c of prev) if (!merged.has(c.id)) merged.set(c.id, c);
          } else {
            for (const c of payload.comments) merged.set(c.id, c);
          }
          return Array.from(merged.values());
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (myRequestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load comments');
      } finally {
        if (myRequestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [eventId]
  );

  // Initial load + reload whenever the event changes.
  useEffect(() => {
    requestIdRef.current++; // invalidate any in-flight fetch from a prior eventId
    setComments([]);
    setMembers([]);
    setViewer(null);
    setTotalCount(0);
    setHasMore(false);
    setNextBefore(null);
    setCollapsedIds(new Set());
    setExpandedChildrenIds(new Set());
    setPendingIds(new Set());
    setReplyOpenId(null);
    setEditOpenId(null);
    fetchComments();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleLoadEarlier = useCallback(() => {
    if (loadingMore || loading || !hasMore || nextBefore == null) return;
    setAutoLoadArmed(true);
    fetchComments({ before: nextBefore, append: true });
  }, [loadingMore, loading, hasMore, nextBefore, fetchComments]);

  // Infinite scroll is armed only after the reader explicitly asks for older
  // comments once. The sentinel sits above the list, so an always-on observer
  // would fire the moment the section scrolled into view and then keep firing
  // as each page arrived — draining the whole thread nobody asked for.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || !autoLoadArmed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore && !loading) {
          handleLoadEarlier();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, autoLoadArmed, handleLoadEarlier]);

  // Close the reaction "+" picker on outside click / Escape.
  useEffect(() => {
    if (!reactionPickerOpenId) return;
    const handlePointer = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setReactionPickerOpenId(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReactionPickerOpenId(null);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [reactionPickerOpenId]);

  useEffect(() => {
    onCountChange?.(totalCount);
  }, [totalCount, onCountChange]);

  const memberById = useMemo(() => {
    const map = new Map<string, MentionMember>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  const memberByUsernameLower = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.username.toLowerCase(), m.user_id);
    return map;
  }, [members]);

  const resolveMemberIdByUsername = useCallback(
    (usernameLower: string) => memberByUsernameLower.get(usernameLower),
    [memberByUsernameLower]
  );

  const tree = useMemo(() => buildCommentTree<CommentWithMeta>(comments), [comments]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandChildren = useCallback((id: string) => {
    setExpandedChildrenIds((prev) => new Set(prev).add(id));
  }, []);

  const openReply = useCallback((id: string) => setReplyOpenId(id), []);
  const closeReply = useCallback(() => setReplyOpenId(null), []);
  const openEdit = useCallback((id: string) => setEditOpenId(id), []);
  const closeEdit = useCallback(() => setEditOpenId(null), []);

  const openReactionPicker = useCallback((id: string) => setReactionPickerOpenId(id), []);
  const closeReactionPicker = useCallback(() => setReactionPickerOpenId(null), []);
  const toggleReactionPanel = useCallback((key: string) => {
    setReactionPanelKey((prev) => (prev === key ? null : key));
  }, []);

  const handleTopLevelSubmit = useCallback(
    async (content: string) => {
      if (!currentUserId) throw new Error('You must be signed in to comment.');
      const tempId = `temp-${++tempCounterRef.current}`;
      const optimistic: CommentWithMeta = {
        id: tempId,
        event_id: eventId,
        user_id: currentUserId,
        username: currentUsername ?? 'You',
        content,
        timestamp: Date.now(),
        parent_id: null,
        edited_at: null,
        deleted_at: null,
        reactions: [],
        mention_user_ids: [],
        reply_count: 0,
      };

      setPendingIds((prev) => new Set(prev).add(tempId));
      setComments((prev) => [...prev, optimistic]);
      setTotalCount((prev) => prev + 1);

      try {
        const res = await fetch('/api/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_id: eventId, parent_id: null, content }),
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(extractErrorMessage(res, data));
        const created = data as CommentWithMeta;
        setComments((prev) => prev.map((c) => (c.id === tempId ? created : c)));
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(tempId);
          return next;
        });
      } catch (err) {
        setComments((prev) => prev.filter((c) => c.id !== tempId));
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(tempId);
          return next;
        });
        setTotalCount((prev) => Math.max(0, prev - 1));
        throw err instanceof Error ? err : new Error('Failed to post comment');
      }
    },
    [currentUserId, currentUsername, eventId]
  );

  const submitReply = useCallback(
    async (parentId: string, content: string) => {
      if (!currentUserId) throw new Error('You must be signed in to reply.');
      const tempId = `temp-${++tempCounterRef.current}`;
      const optimistic: CommentWithMeta = {
        id: tempId,
        event_id: eventId,
        user_id: currentUserId,
        username: currentUsername ?? 'You',
        content,
        timestamp: Date.now(),
        parent_id: parentId,
        edited_at: null,
        deleted_at: null,
        reactions: [],
        mention_user_ids: [],
        reply_count: 0,
      };

      setPendingIds((prev) => new Set(prev).add(tempId));
      setComments((prev) => [...prev, optimistic]);
      setTotalCount((prev) => prev + 1);

      try {
        const res = await fetch('/api/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_id: eventId, parent_id: parentId, content }),
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(extractErrorMessage(res, data));
        const created = data as CommentWithMeta;
        setComments((prev) => prev.map((c) => (c.id === tempId ? created : c)));
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(tempId);
          return next;
        });
        setReplyOpenId(null);
      } catch (err) {
        setComments((prev) => prev.filter((c) => c.id !== tempId));
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(tempId);
          return next;
        });
        setTotalCount((prev) => Math.max(0, prev - 1));
        throw err instanceof Error ? err : new Error('Failed to post reply');
      }
    },
    [currentUserId, currentUsername, eventId]
  );

  const submitEdit = useCallback(async (comment: CommentWithMeta, content: string) => {
    const previousContent = comment.content;
    const previousEditedAt = comment.edited_at ?? null;
    const localEditedAt = new Date().toISOString();

    setComments((prev) =>
      prev.map((c) => (c.id === comment.id ? { ...c, content, edited_at: localEditedAt } : c))
    );

    try {
      const res = await fetch('/api/comments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: comment.id, content }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(extractErrorMessage(res, data));
      const updated = data as CommentWithMeta;
      setComments((prev) => prev.map((c) => (c.id === comment.id ? updated : c)));
      setEditOpenId(null);
    } catch (err) {
      setComments((prev) =>
        prev.map((c) => (c.id === comment.id ? { ...c, content: previousContent, edited_at: previousEditedAt } : c))
      );
      throw err instanceof Error ? err : new Error('Failed to save comment');
    }
  }, []);

  const requestDelete = useCallback((comment: CommentWithMeta) => setDeleteTarget(comment), []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setDeletingIds((prev) => new Set(prev).add(target.id));

    // A tombstone only earns its place when a reply still needs its context.
    // With no replies, drop the row outright — the server's thread view omits
    // childless tombstones too, so leaving one would show a "Comment deleted"
    // placeholder that vanishes on the next reload.
    const tombstoneStamp = new Date().toISOString();
    const hasReplies = comments.some((c) => c.parent_id === target.id);
    setComments((prev) =>
      hasReplies
        ? prev.map((c) => (c.id === target.id ? { ...c, deleted_at: tombstoneStamp, content: '', username: '' } : c))
        : prev.filter((c) => c.id !== target.id)
    );
    setTotalCount((prev) => Math.max(0, prev - 1));

    try {
      const res = await fetch(`/api/comments?id=${encodeURIComponent(target.id)}`, { method: 'DELETE' });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(extractErrorMessage(res, data));
      const tombstone = (data as { comment: CommentWithMeta }).comment;
      // A no-op when the row was dropped above; map never re-adds it.
      setComments((prev) => prev.map((c) => (c.id === target.id ? tombstone : c)));
    } catch (err) {
      // Restore in place if the row is still there, otherwise put the removed
      // one back where it belongs (buildCommentTree re-sorts by timestamp).
      setComments((prev) =>
        prev.some((c) => c.id === target.id)
          ? prev.map((c) => (c.id === target.id ? target : c))
          : [...prev, target]
      );
      setTotalCount((prev) => prev + 1);
      setToast({ message: err instanceof Error ? err.message : 'Failed to delete comment', type: 'error' });
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
    }
  }, [deleteTarget, comments]);

  const toggleReaction = useCallback(
    (comment: CommentWithMeta, emoji: string) => {
      if (!currentUserId) return;
      const key = `${comment.id}:${emoji}`;
      if (reactionInFlight.has(key)) return;
      setReactionInFlight((prev) => new Set(prev).add(key));

      const previousReactions = comment.reactions;
      const existing = comment.reactions.find((r) => r.emoji === emoji);
      const hasReacted = existing?.user_ids.includes(currentUserId) ?? false;

      let optimisticReactions: CommentReactionSummary[];
      if (hasReacted) {
        optimisticReactions = comment.reactions
          .map((r) =>
            r.emoji === emoji
              ? { ...r, count: r.count - 1, user_ids: r.user_ids.filter((id) => id !== currentUserId) }
              : r
          )
          .filter((r) => r.count > 0);
      } else if (existing) {
        optimisticReactions = comment.reactions.map((r) =>
          r.emoji === emoji ? { ...r, count: r.count + 1, user_ids: [...r.user_ids, currentUserId] } : r
        );
      } else {
        optimisticReactions = [...comment.reactions, { emoji, count: 1, user_ids: [currentUserId] }];
      }

      setComments((prev) => prev.map((c) => (c.id === comment.id ? { ...c, reactions: optimisticReactions } : c)));

      fetch('/api/comments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment_id: comment.id, emoji }),
      })
        .then(async (res) => {
          const data = await safeJson(res);
          if (!res.ok) throw new Error(extractErrorMessage(res, data));
          const payload = data as { reactions: CommentReactionSummary[] };
          setComments((prev) => prev.map((c) => (c.id === comment.id ? { ...c, reactions: payload.reactions } : c)));
        })
        .catch((err) => {
          setComments((prev) => prev.map((c) => (c.id === comment.id ? { ...c, reactions: previousReactions } : c)));
          setToast({ message: err instanceof Error ? err.message : 'Failed to react', type: 'error' });
        })
        .finally(() => {
          setReactionInFlight((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        });
    },
    [currentUserId, reactionInFlight]
  );

  const actions: ThreadActions = {
    currentUserId,
    viewer,
    canWrite,
    members,
    memberById,
    resolveMemberIdByUsername,
    now,
    pendingIds,
    collapsedIds,
    toggleCollapse,
    expandedChildrenIds,
    expandChildren,
    replyOpenId,
    openReply,
    closeReply,
    submitReply,
    editOpenId,
    openEdit,
    closeEdit,
    submitEdit,
    deletingIds,
    requestDelete,
    reactionInFlight,
    toggleReaction,
    reactionPickerOpenId,
    openReactionPicker,
    closeReactionPicker,
    reactionPanelKey,
    toggleReactionPanel,
    pickerRef,
  };

  return (
    <div>
      <Toast
        isOpen={toast !== null}
        onClose={() => setToast(null)}
        message={toast?.message ?? ''}
        type={toast?.type ?? 'info'}
      />
      <ConfirmationModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Comment"
        message={`Are you sure you want to delete ${
          deleteTarget ? `@${deleteTarget.username}'s comment` : 'this comment'
        }? This action cannot be undone.`}
        confirmText="Delete"
        type="danger"
        loading={deleteTarget !== null && deletingIds.has(deleteTarget.id)}
      />

      {canWrite && (
        <div className="mb-4">
          <CommentForm
            members={members}
            submitLabel="Post"
            pendingLabel="Posting…"
            placeholder="Add a comment…  (@ to mention)"
            maxLength={MAX_COMMENT_LENGTH}
            onSubmit={handleTopLevelSubmit}
          />
        </div>
      )}

      {hasMore && (
        <div className="mb-3 text-center">
          <button
            type="button"
            disabled={loadingMore}
            className="btn-glass text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleLoadEarlier}
          >
            {loadingMore ? 'Loading…' : 'Load earlier comments'}
          </button>
        </div>
      )}
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
          <div className="skeleton h-20 rounded-2xl" />
        </div>
      ) : error ? (
        <div className="glass rounded-2xl p-4 text-center">
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <button type="button" className="btn-glass text-sm px-4 py-2" onClick={() => fetchComments()}>
            Retry
          </button>
        </div>
      ) : tree.length === 0 ? (
        <p className="text-muted-2 text-center py-8">No comments yet — start the conversation.</p>
      ) : (
        <ul className="space-y-3">
          {tree.map((node) => (
            <CommentNodeItem key={node.comment.id} node={node} actions={actions} />
          ))}
        </ul>
      )}
    </div>
  );
}
