'use client';

// The blank-betting-slip empty state that replaces every icon-in-a-circle.
// Same card shape as a real wager, but with a dashed border and ghosted
// odds — it should read as "the same object as a real wager card, just
// unfilled," not as a distinct system-generated placeholder.
//
// Marked 'use client' only because the optional `action` prop may carry an
// onClick handler, which needs a client component boundary to attach. If a
// caller only ever passes `href`, this still works fine from a server tree.

import Link from 'next/link';

export interface EmptySlipAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface EmptySlipProps {
  /** Defaults to "No action yet." */
  headline?: string;
  /** Defaults to "Start the first bet." */
  body?: string;
  action?: EmptySlipAction;
  className?: string;
}

const DEFAULT_HEADLINE = 'No action yet.';
const DEFAULT_BODY = 'Start the first bet.';

export default function EmptySlip({ headline, body, action, className }: EmptySlipProps) {
  return (
    <div
      className={`rounded-card border-2 border-dashed border-line bg-card p-5 ${className ?? ''}`}
    >
      <div
        aria-hidden="true"
        className="font-mono text-3xl font-medium tabular-nums text-ink opacity-40"
      >
        — : —
      </div>

      <div className="mt-3 space-y-1">
        <p className="font-sans font-semibold text-ink">{headline ?? DEFAULT_HEADLINE}</p>
        <p className="font-sans text-sm text-ink-muted">{body ?? DEFAULT_BODY}</p>
      </div>

      {action && (
        <div className="mt-4">
          {action.href ? (
            <Link
              href={action.href}
              className="inline-flex items-center rounded-control bg-emerald px-4 py-2 font-sans text-sm font-medium text-on-emerald transition-colors duration-fast hover:opacity-90"
            >
              {action.label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={action.onClick}
              className="inline-flex items-center rounded-control bg-emerald px-4 py-2 font-sans text-sm font-medium text-on-emerald transition-colors duration-fast hover:opacity-90"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
