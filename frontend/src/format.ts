// Shared display formatters.

export function formatBytesPerSec(bytes: number): string {
  if (!bytes) return '0'
  return `${formatBytes(bytes)}/s`
}

export function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

export function formatUptime(seconds: number): string {
  if (!seconds) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/**
 * Like formatUptime but honest about short spans: a database session
 * that started four seconds ago is "4s", not "0m".
 */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return '<1s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  return formatUptime(seconds)
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/**
 * How long ago, in the words people use.
 *
 * A timestamp to the second answers a question nobody asked: what
 * matters about an agent's last check-in is whether it was minutes or
 * days, and an exact clock time makes the reader do the arithmetic.
 * Deliberately coarse — "about 5 hours ago" is the honest precision
 * when the underlying number is a poll interval anyway.
 */
export function timeAgo(unixSeconds: number): string {
  if (!unixSeconds) return 'never'
  const seconds = Math.round(Date.now() / 1000 - unixSeconds)
  if (seconds < 0) return 'just now'
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `about ${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
