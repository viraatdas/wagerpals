// Pure display-formatting helpers shared across screens.
//
// Every function here must be safe to call with garbage input (NaN,
// undefined smuggled through `any`, negative numbers, empty strings) without
// throwing — a malformed value should degrade to a sane-looking placeholder,
// never crash a render.

// Coerces anything that isn't a finite number to 0, so a bad value renders as
// "$0.00" instead of "$NaN" or throwing inside toFixed().
function safeNumber(n: number | undefined | null): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

export function formatMoney(n: number, opts?: { sign?: boolean }): string {
  const value = safeNumber(n);
  const formatted = `$${Math.abs(value).toFixed(2)}`;
  if (opts?.sign && value !== 0) {
    return value > 0 ? `+${formatted}` : `-${formatted}`;
  }
  return formatted;
}

// Plain-text form of a W (play-currency) amount, e.g. "W40" (no space) —
// for accessibility labels, activity strings and anywhere a <WAmount> isn't
// renderable (plain strings, notification copy). Mirrors formatMoney's
// shape/signature but without decimals for whole numbers, since W stakes
// are typically integers; a fractional amount still renders with 2 decimals
// rather than silently truncating.
export function formatW(n: number, opts?: { sign?: boolean }): string {
  const value = safeNumber(n);
  const abs = Math.abs(value);
  const digits = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  const formatted = `W${digits}`;
  if (opts?.sign && value !== 0) {
    return value > 0 ? `+${formatted}` : `-${formatted}`;
  }
  return formatted;
}

// Above $1000, collapse to one decimal ("$1.2k") so amounts stay scannable
// in tight UI (activity rows, wallet summaries). Below that, behaves like
// formatMoney.
export function formatCompactMoney(n: number): string {
  const value = safeNumber(n);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs >= 1000) {
    const thousands = abs / 1000;
    // Avoid a trailing ".0" ("$2k" not "$2.0k") while still showing one
    // decimal place when it's meaningful ("$1.2k").
    const digits = thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1);
    return `${sign}$${digits}k`;
  }

  return `${sign}$${abs.toFixed(2)}`;
}

// Core "how long ago" logic — this used to live in helpers.ts as
// `formatDate`. It moved here so all formatting utilities live in one place;
// helpers.ts re-exports it under the old name so existing imports keep working.
export function formatRelativeTime(ts: number): string {
  const timestamp = safeNumber(ts);
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return 'just now';
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else if (days < 7) {
    return `${days}d ago`;
  } else {
    return date.toLocaleDateString();
  }
}

// Renders the largest one or two meaningful units of a duration, matching
// the "3h 12m" / "2d" style used by formatCountdown. Clamped to >= 0 so a
// slightly-negative rounding error never prints "-1s".
function formatDurationParts(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(safeNumber(ms) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function formatCountdown(endTime: number): { label: string; isPast: boolean } {
  const end = safeNumber(endTime);
  const diff = end - Date.now();

  if (diff <= 0) {
    return { label: `Ended ${formatDurationParts(-diff)} ago`, isPast: true };
  }
  return { label: `Ends in ${formatDurationParts(diff)}`, isPast: false };
}

// e.g. "Mar 4, 7:30 PM"
export function formatDateTime(ts: number): string {
  const date = new Date(safeNumber(ts));
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

// Renders a USERNAME as an inline "@handle" — mirrors lib/utils.ts's `handle`
// on the web side so both platforms format usernames identically. Guarded
// against double-prefixing a value that already starts with '@'. Display-only:
// never use this to build mention syntax that gets parsed/stored (see
// mobile/src/utils/mentions.ts) or to prefill an editable username
// input/payload — those need the raw value.
export function handle(username: string): string {
  if (!username) return username;
  return username.startsWith('@') ? username : `@${username}`;
}

export function truncate(s: string, n: number): string {
  if (typeof s !== 'string' || s.length === 0) {
    return '';
  }
  const limit = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (limit === 0) {
    return '';
  }
  if (s.length <= limit) {
    return s;
  }
  if (limit === 1) {
    return s.slice(0, 1);
  }
  return `${s.slice(0, limit - 1)}…`;
}
