const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Compact relative time for the versions list — "4h ago" (DESIGN §3.5).
 * `timestamp` is in seconds, matching git's %ct.
 */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const seconds = Math.floor(now / 1000) - timestamp;
  if (seconds < 0) return "just now";
  if (seconds < 45) return "just now";
  if (seconds < HOUR) return `${Math.max(1, Math.floor(seconds / MINUTE))}m ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;

  const days = Math.floor(seconds / DAY);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
