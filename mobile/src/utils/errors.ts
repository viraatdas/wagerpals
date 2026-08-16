// Typed error surface for the API layer.
//
// Every failure that reaches a screen — a dropped connection, an aborted
// request, a non-2xx response, or a response body that isn't valid JSON —
// is normalized into an `ApiError` before it leaves `services/api.ts`. That
// gives screens one shape to branch on (`.kind`, `.status`, `.code`) instead
// of having to guess whether a caught value is a native `TypeError`, a DOMException
// from an aborted fetch, or a hand-rolled `Error` with a message we made up.

// 'network'  — the request never got a response (offline, DNS failure, connection reset).
// 'timeout'  — we aborted the request ourselves because it exceeded the deadline.
// 'http'     — the server responded, but with a non-2xx status.
// 'parse'    — we got a response (or thought we did) but couldn't make sense of it.
export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse';

export interface ApiErrorInit {
  message: string;
  status: number | null;
  kind: ApiErrorKind;
  endpoint: string;
  code?: string;
}

export class ApiError extends Error {
  /** HTTP status code, or null when the failure happened before/without a response (network, timeout, parse). */
  readonly status: number | null;
  /** Machine-readable error code from the server body's `code` field, e.g. INVALID_AMOUNT / AMOUNT_TOO_LARGE / INSUFFICIENT_FUNDS. */
  readonly code?: string;
  readonly kind: ApiErrorKind;
  /** The request path this error came from, e.g. "/api/wallet" — useful for logging and cache invalidation debugging. */
  readonly endpoint: string;
  /** The raw server-provided `error` string (if any), kept separate from `.message` so `userMessage` can decide when it's safe to show verbatim. */
  private readonly serverMessage?: string;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.kind = init.kind;
    this.endpoint = init.endpoint;
    this.code = init.code;
    this.serverMessage = init.message || undefined;

    // Without this, `instanceof ApiError` can fail on some JS engines/transpile
    // targets when extending a built-in like Error — restore the prototype
    // chain explicitly so callers can reliably narrow on `instanceof ApiError`.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  get isOffline(): boolean {
    return this.kind === 'network';
  }

  get isTimeout(): boolean {
    return this.kind === 'timeout';
  }

  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /**
   * A human sentence safe to render directly in the UI — never a raw stack
   * trace or a server-internal message the user can't act on.
   */
  get userMessage(): string {
    if (this.kind === 'network') {
      return 'You appear to be offline. Check your connection and try again.';
    }
    if (this.kind === 'timeout') {
      return 'That took too long. Tap to try again.';
    }
    if (this.status === 401) {
      return 'Your session expired. Please sign in again.';
    }
    if (this.status === 403) {
      return this.serverMessage || "You don't have permission to do that.";
    }
    if (this.status !== null && this.status >= 500) {
      return 'Something went wrong on our end. Please try again.';
    }
    return this.serverMessage || 'Something went wrong. Please try again.';
  }
}

/**
 * Wraps anything thrown during a request (a fetch-level TypeError, an
 * AbortError from our own timeout controller, a JSON parse failure, or an
 * already-normalized ApiError) into an ApiError. This is the single funnel
 * so `request<T>()` never lets a bare Error escape to a screen.
 */
export function toApiError(e: unknown, endpoint: string): ApiError {
  if (e instanceof ApiError) {
    return e;
  }

  if (e instanceof Error) {
    // AbortController.abort() causes fetch to reject with a DOMException (or,
    // on some RN/polyfill environments, a plain Error) named "AbortError".
    if (e.name === 'AbortError') {
      return new ApiError({
        message: 'Request timed out',
        status: null,
        kind: 'timeout',
        endpoint,
      });
    }

    // React Native's fetch throws a plain TypeError ("Network request failed")
    // when the device has no connectivity or the host is unreachable — there
    // is no HTTP response to inspect at all.
    if (e instanceof TypeError || /network/i.test(e.message)) {
      return new ApiError({
        message: e.message || 'Network request failed',
        status: null,
        kind: 'network',
        endpoint,
      });
    }

    return new ApiError({
      message: e.message || 'Something went wrong.',
      status: null,
      kind: 'parse',
      endpoint,
    });
  }

  return new ApiError({
    message: 'Something went wrong.',
    status: null,
    kind: 'parse',
    endpoint,
  });
}
