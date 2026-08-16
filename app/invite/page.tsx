import type { Metadata } from 'next';
import Link from 'next/link';

// Server component (not 'use client') so we can produce real per-invite
// OpenGraph metadata. This page is what a visitor lands on when they tap an
// iMessage wager bubble / universal link and DON'T have the app installed —
// its whole job is to (a) unfurl richly in the Messages bubble preview and
// (b) route the visitor to the App Store.

const APP_STORE_URL = 'https://apps.apple.com/app/id6754625373';
const UNIVERSAL_LINK_BASE = 'https://wagerpals.io';
const DEFAULT_TITLE = "You've been invited to a wager";
const DEFAULT_SIDE_A = 'Side A';
const DEFAULT_SIDE_B = 'Side B';

type SearchParams = { [key: string]: string | string[] | undefined };

interface InviteData {
  eventId?: string;
  shareToken?: string;
  title: string;
  sideA: string;
  sideB: string;
  sideACount?: number;
  sideBCount?: number;
  sideATotal?: number;
  sideBTotal?: number;
  endTime?: number;
  status?: string;
  winningSide?: string;
  paymentType?: 'cash' | 'none';
  stakeAmount?: number;
  totalBets?: number;
  totalParticipants?: number;
  // Legacy-only field, kept purely to preserve old-link behavior.
  legacyPick?: string;
}

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parses the compact snapshot the native iMessage extension embeds in the
 * bubble URL (`e`,`t`,`title`,`a`,`b`,`ac`,`bc`,`at`,`bt`,`end`,`st`,`ws`,
 * `pt`,`sa`,`tb`,`tp`), so the page renders something meaningful with zero
 * round-trips. Also understands the old param names (`title`,`sideA`,
 * `sideB`,`pick`,`amount`) so existing links keep working.
 */
function parseSnapshot(searchParams: SearchParams): InviteData {
  const get = (key: string) => first(searchParams[key]);

  const paymentTypeRaw = get('pt');
  const paymentType: 'cash' | 'none' | undefined =
    paymentTypeRaw === 'cash' ? 'cash' : paymentTypeRaw === 'none' ? 'none' : undefined;

  return {
    eventId: get('e'),
    shareToken: get('t'),
    title: get('title') || DEFAULT_TITLE,
    sideA: get('a') || get('sideA') || DEFAULT_SIDE_A,
    sideB: get('b') || get('sideB') || DEFAULT_SIDE_B,
    sideACount: toNumber(get('ac')),
    sideBCount: toNumber(get('bc')),
    sideATotal: toNumber(get('at')),
    sideBTotal: toNumber(get('bt')),
    endTime: toNumber(get('end')),
    status: get('st'),
    winningSide: get('ws'),
    paymentType,
    stakeAmount: toNumber(get('sa')) ?? toNumber(get('amount')),
    totalBets: toNumber(get('tb')),
    totalParticipants: toNumber(get('tp')),
    legacyPick: get('pick'),
  };
}

function compact<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  (Object.keys(obj) as (keyof T)[]).forEach((key) => {
    if (obj[key] !== undefined) out[key] = obj[key];
  });
  return out;
}

/**
 * Best-effort live lookup. The preview API is owned by a sibling agent and
 * may not exist yet (404) or may be mid-flight — any failure here just means
 * we fall back to the snapshot, never a broken page.
 */
async function fetchLivePreview(
  eventId: string,
  shareToken: string | undefined
): Promise<Partial<InviteData> | null> {
  try {
    const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://wagerpals.io').replace(/\/$/, '');
    const url = `${base}/api/events/preview?id=${encodeURIComponent(eventId)}${
      shareToken ? `&t=${encodeURIComponent(shareToken)}` : ''
    }`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;

    const data = await res.json();
    if (!data || typeof data !== 'object') return null;

    const sideA: string | undefined = typeof data.side_a === 'string' ? data.side_a : undefined;
    const sideB: string | undefined = typeof data.side_b === 'string' ? data.side_b : undefined;

    // GET /api/events/preview returns FLAT per-side fields (side_a_count,
    // side_b_count, side_a_total, side_b_total) — deliberately not the
    // side-label-keyed `side_stats` map that GET /api/events?id= returns.
    // Flat keys are what the native iMessage extension decodes too, so this
    // page and the extension consume one identical contract. `*_total` is
    // null unless a valid share token was presented, which is why the totals
    // are read as "number or leave undefined" rather than defaulted to 0.
    return compact({
      title: typeof data.title === 'string' ? data.title : undefined,
      sideA,
      sideB,
      sideACount: typeof data.side_a_count === 'number' ? data.side_a_count : undefined,
      sideBCount: typeof data.side_b_count === 'number' ? data.side_b_count : undefined,
      sideATotal: typeof data.side_a_total === 'number' ? data.side_a_total : undefined,
      sideBTotal: typeof data.side_b_total === 'number' ? data.side_b_total : undefined,
      endTime: typeof data.end_time === 'number' ? data.end_time : undefined,
      status: typeof data.status === 'string' ? data.status : undefined,
      winningSide: typeof data.winning_side === 'string' ? data.winning_side : undefined,
      paymentType:
        data.payment_type === 'cash' || data.payment_type === 'none' ? data.payment_type : undefined,
      stakeAmount: typeof data.stake_amount === 'number' ? data.stake_amount : undefined,
      totalBets: typeof data.total_bets === 'number' ? data.total_bets : undefined,
      totalParticipants: typeof data.total_participants === 'number' ? data.total_participants : undefined,
    } satisfies Partial<InviteData>);
  } catch {
    return null;
  }
}

/**
 * Single source of truth for both generateMetadata and the page body, so
 * the unfurl and the rendered card can never disagree. Next.js request-
 * memoizes identical fetch() calls made during the same render pass, so
 * calling this from both entry points does not double the network hit.
 */
async function resolveInvite(searchParams: SearchParams): Promise<InviteData> {
  const snapshot = parseSnapshot(searchParams);
  if (!snapshot.eventId) return snapshot;

  const live = await fetchLivePreview(snapshot.eventId, snapshot.shareToken);
  if (!live) return snapshot;

  const merged: InviteData = { ...snapshot, ...live };
  // Re-apply defaults in case the live title/sides came back empty strings.
  merged.title = merged.title || DEFAULT_TITLE;
  merged.sideA = merged.sideA || DEFAULT_SIDE_A;
  merged.sideB = merged.sideB || DEFAULT_SIDE_B;
  return merged;
}

function formatDeadline(endTime: number): string {
  return new Date(endTime).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatStatusLabel(invite: InviteData): string {
  if (invite.status === 'resolved') {
    return invite.winningSide ? `Resolved · ${invite.winningSide} won` : 'Resolved';
  }
  if (invite.endTime && invite.endTime <= Date.now()) return 'Closed';
  return invite.endTime ? `Closes ${formatDeadline(invite.endTime)}` : 'Open';
}

function formatStakeText(invite: InviteData): string | null {
  if (invite.paymentType !== 'cash') return null;
  if (typeof invite.stakeAmount === 'number' && invite.stakeAmount > 0) {
    return `$${invite.stakeAmount % 1 === 0 ? invite.stakeAmount : invite.stakeAmount.toFixed(2)} on the line`;
  }
  return 'Real money on the line';
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const invite = await resolveInvite(searchParams);

  const descriptionParts = [`${invite.sideA} vs ${invite.sideB}`];
  if (invite.status === 'resolved') {
    descriptionParts.push(invite.winningSide ? `${invite.winningSide} won` : 'settled');
  } else if (invite.endTime) {
    descriptionParts.push(`closes ${formatDeadline(invite.endTime)}`);
  }
  const stakeText = formatStakeText(invite);
  if (stakeText) descriptionParts.push(stakeText);
  const description = descriptionParts.join(' · ');

  const path = invite.eventId ? `/invite?e=${encodeURIComponent(invite.eventId)}` : '/invite';
  const ogImageAlt = `${invite.sideA} vs ${invite.sideB} on WagerPals`;

  return {
    title: invite.title,
    description,
    openGraph: {
      type: 'website',
      siteName: 'WagerPals',
      title: invite.title,
      description,
      url: path,
      // metadataBase (set in the root layout) resolves this to an absolute
      // https://wagerpals.io/og.png URL for crawlers.
      images: [{ url: '/og.png', width: 1200, height: 630, alt: ogImageAlt }],
    },
    twitter: {
      card: 'summary_large_image',
      title: invite.title,
      description,
      images: ['/og.png'],
    },
  };
}

export default async function InvitePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const invite = await resolveInvite(searchParams);

  const hasEvent = Boolean(invite.eventId);
  const statusLabel = formatStatusLabel(invite);
  const stakeText = formatStakeText(invite);
  const isResolved = invite.status === 'resolved';

  // "Open in WagerPals" must point at the real wagerpals.io universal-link
  // domain (not a relative/preview URL) so iOS actually intercepts it,
  // falling back to the legacy custom scheme for very old links with no
  // event id at all.
  const legacyParams = `${invite.legacyPick ? `&pick=${encodeURIComponent(invite.legacyPick)}` : ''}${
    invite.stakeAmount ? `&amount=${encodeURIComponent(invite.stakeAmount)}` : ''
  }`;
  const openInAppHref = hasEvent
    ? `${UNIVERSAL_LINK_BASE}/events/${encodeURIComponent(invite.eventId as string)}`
    : `wagerpals://invite?title=${encodeURIComponent(invite.title)}&sideA=${encodeURIComponent(
        invite.sideA
      )}&sideB=${encodeURIComponent(invite.sideB)}${legacyParams}`;
  const openOnWebHref = hasEvent
    ? `/events/${encodeURIComponent(invite.eventId as string)}`
    : `/create?title=${encodeURIComponent(invite.title)}&sideA=${encodeURIComponent(
        invite.sideA
      )}&sideB=${encodeURIComponent(invite.sideB)}${legacyParams}`;

  // Presentation-only: a visitor who lands on /invite with no event id, no
  // legacy pick, and none of the title/side query params filled in has
  // nothing to see here — point them at making their own wager instead of
  // rendering a fake "Side A vs Side B" card.
  const isEmptyInvite =
    !hasEvent &&
    !invite.legacyPick &&
    invite.title === DEFAULT_TITLE &&
    invite.sideA === DEFAULT_SIDE_A &&
    invite.sideB === DEFAULT_SIDE_B;

  // Status tone: resolved markets take the winner's colour (or neutral if
  // the winner isn't known), a closed-but-unresolved market is "pending" an
  // outcome, and a still-open market is purely informational.
  const statusTone = isResolved
    ? invite.winningSide === invite.sideA
      ? 'tone-yes'
      : invite.winningSide === invite.sideB
      ? 'tone-no'
      : 'tone-neutral'
    : invite.endTime && invite.endTime <= Date.now()
    ? 'tone-pending'
    : 'tone-info';

  const hasBothCounts = typeof invite.sideACount === 'number' && typeof invite.sideBCount === 'number';
  const totalCount = hasBothCounts ? (invite.sideACount as number) + (invite.sideBCount as number) : 0;
  const sideAPct = hasBothCounts && totalCount > 0 ? Math.round(((invite.sideACount as number) / totalCount) * 100) : 50;

  return (
    <div className="page-shell-narrow mobile-page animate-rise">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="display-2 mb-1">WagerPals</h1>
        <p className="lede mx-auto">You&apos;ve been invited to a wager!</p>
      </div>

      {isEmptyInvite ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <span className="text-2xl" aria-hidden="true">🎟️</span>
          </div>
          <p className="empty-state-title">Nothing to invite to yet</p>
          <p className="empty-state-body">
            This link isn&apos;t tied to a wager. Start one with your group, then share that link instead.
          </p>
          <Link href="/create" className="btn-primary press mt-2">
            Create an event
          </Link>
        </div>
      ) : (
        <>
          {/* Wager Card */}
          <div className={`card-focal rail-top ${statusTone} p-8 mb-8`}>
            <div className="flex justify-center mb-4">
              <span className={`pill ${statusTone}`}>
                <span className="tone-dot" aria-hidden="true" />
                {statusLabel}
              </span>
            </div>

            <h2 className="market-title text-2xl text-center mb-6">{invite.title}</h2>

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mb-4">
              <div className="tone-yes tone-surface border rounded-2xl p-4 text-center min-w-0">
                <p className="eyebrow mb-1 truncate">{invite.sideA}</p>
                {typeof invite.sideACount === 'number' && (
                  <p className="tone-text font-semibold">
                    {invite.sideACount} {invite.sideACount === 1 ? 'backer' : 'backers'}
                  </p>
                )}
              </div>
              <span className="eyebrow">vs</span>
              <div className="tone-no tone-surface border rounded-2xl p-4 text-center min-w-0">
                <p className="eyebrow mb-1 truncate">{invite.sideB}</p>
                {typeof invite.sideBCount === 'number' && (
                  <p className="tone-text font-semibold">
                    {invite.sideBCount} {invite.sideBCount === 1 ? 'backer' : 'backers'}
                  </p>
                )}
              </div>
            </div>

            {hasBothCounts && (
              <div className="odds-track mb-4">
                <div className="odds-fill odds-fill-yes" style={{ width: `${sideAPct}%` }} />
                <div className="odds-fill odds-fill-no" style={{ width: `${100 - sideAPct}%` }} />
              </div>
            )}

            <p className="text-center text-sm text-muted">
              {stakeText ||
                (invite.legacyPick
                  ? `Suggested pick: ${invite.legacyPick}.`
                  : 'Open the app or the web to see the latest odds and place a bet.')}
            </p>
          </div>

          {/* Invite link — large, monospace, one-click-selectable so it can
              be copied without any client-side JS on this server page. */}
          {hasEvent && (
            <div className="card p-5 mb-8">
              <p className="field-label mb-2">Invite link</p>
              <p className="select-all break-all font-mono text-sm text-foreground">{openInAppHref}</p>
              <p className="field-hint mt-2">Tap the link to select it, then copy and share it anywhere.</p>
            </div>
          )}

          {/* Action Buttons — equal-weight choices */}
          <div className="space-y-3">
            <a href={openInAppHref} className="btn-glass press block w-full py-4 text-center text-lg">
              Open in WagerPals
            </a>

            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary on-accent press block w-full py-4 text-center text-lg"
            >
              Get WagerPals on the App Store
            </a>

            <Link href={openOnWebHref} className="btn-glass press block w-full py-4 text-center text-lg">
              Open on the web
            </Link>
          </div>
        </>
      )}

      {/* Explainer for visitors without the app (which, by definition, is everyone here) */}
      <p className="text-center text-xs text-muted mt-8">
        WagerPals is a lightweight place where friends create wagers and settle up together.{' '}
        <Link href="/" className="text-brand-2 hover:underline">
          Learn more
        </Link>
      </p>
      <noscript>
        <p className="text-center text-xs text-muted mt-2">
          Don&apos;t have the app? Get it at {APP_STORE_URL}
        </p>
      </noscript>
    </div>
  );
}
