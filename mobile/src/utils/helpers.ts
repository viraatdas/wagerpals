// Utility functions
import { formatRelativeTime } from './format';

export function generateId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

// The "how long ago" logic now lives in utils/format.ts as formatRelativeTime
// (alongside the rest of the display-formatting helpers). Re-exported here
// under its original name so existing `formatDate` call sites keep working.
export function formatDate(timestamp: number): string {
  return formatRelativeTime(timestamp);
}

// Mirrors lib/utils.ts's validateUsername exactly — the server is the source of truth.
export function validateUsername(username: string): { valid: boolean; error?: string } {
  const trimmed = username.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'Username is required' };
  }

  if (trimmed.length < 2) {
    return { valid: false, error: 'Username must be at least 2 characters' };
  }

  if (trimmed.length > 20) {
    return { valid: false, error: 'Username must be 20 characters or less' };
  }

  // Only allow alphanumeric characters and underscores
  const validPattern = /^[a-zA-Z0-9_]+$/;
  if (!validPattern.test(trimmed)) {
    return { valid: false, error: 'Username can only contain letters, numbers, and underscores' };
  }

  return { valid: true };
}

export function normalizeUsername(username: string): string {
  return username.toLowerCase().trim();
}





