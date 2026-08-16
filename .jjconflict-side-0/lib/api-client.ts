/**
 * Client-side fetch wrapper that adds the authenticated user's ID to requests.
 * Use this for all API calls from the web app to ensure auth middleware works.
 */
export function createAuthFetch(userId: string) {
  return async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    headers.set('x-stack-user-id', userId);
    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json');
    }

    return fetch(url, {
      ...options,
      headers,
    });
  };
}
