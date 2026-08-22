/**
 * A window of time, as this console passes one around.
 *
 * RESOLVED, NOT RELATIVE. Picking "last 24 hours" stamps the bounds at
 * that moment rather than keeping a rule that re-evaluates: a sliding
 * window changes the query on every render, refetching under the
 * cursor and renumbering the pages beneath you, and it never settles.
 * The label remembers what was asked for so the button can still say
 * "Last 24 hours".
 */
export interface TimeRange {
  /** What the button shows. */
  label: string
  /** ISO bounds. Both absent means every record there is. */
  since?: string
  until?: string
}

export const ANY_TIME: TimeRange = { label: 'Any time' }

/** The windows worth a click, in the order a list should show them. */
export const presets: { label: string; seconds: number }[] = [
  { label: 'Last 15 minutes', seconds: 15 * 60 },
  { label: 'Last 30 minutes', seconds: 30 * 60 },
  { label: 'Last 1 hour', seconds: 3600 },
  { label: 'Last 3 hours', seconds: 3 * 3600 },
  { label: 'Last 6 hours', seconds: 6 * 3600 },
  { label: 'Last 12 hours', seconds: 12 * 3600 },
  { label: 'Last 24 hours', seconds: 24 * 3600 },
  { label: 'Last 7 days', seconds: 7 * 24 * 3600 },
  { label: 'Last 30 days', seconds: 30 * 24 * 3600 },
  { label: 'Last 90 days', seconds: 90 * 24 * 3600 },
]

export function lastRange(label: string, seconds: number, now = Date.now()): TimeRange {
  return { label, since: new Date(now - seconds * 1000).toISOString() }
}

/** Midnight-to-midnight in the BROWSER's timezone, because "today" is
 *  a question about where the person asking is standing, not about UTC. */
export function dayRange(offsetDays: number, now = new Date()): TimeRange {
  const start = new Date(now)
  start.setDate(start.getDate() - offsetDays)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return {
    label: offsetDays === 0 ? 'Today' : offsetDays === 1 ? 'Yesterday' : start.toLocaleDateString(),
    since: start.toISOString(),
    // Today has no end: capping it at midnight would hide anything
    // that happens while you are reading the page.
    until: offsetDays === 0 ? undefined : end.toISOString(),
  }
}

const relativeRe = /^\s*(\d+)\s*(s|m|h|d|w)\s*$/i

const unitSeconds: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 24 * 3600,
  w: 7 * 24 * 3600,
}

const unitWords: Record<string, string> = {
  s: 'seconds',
  m: 'minutes',
  h: 'hours',
  d: 'days',
  w: 'weeks',
}

/**
 * "15m", "1h", "1d", "2w" — the shorthand anyone who has used a log
 * console already types. Returns nothing for anything else, so the
 * field can go red instead of guessing.
 */
export function parseRelative(text: string, now = Date.now()): TimeRange | null {
  const match = relativeRe.exec(text)
  if (!match) return null
  const value = Number(match[1])
  const unit = match[2].toLowerCase()
  if (!value) return null
  const seconds = value * unitSeconds[unit]
  const word = unitWords[unit]
  return lastRange(`Last ${value} ${value === 1 ? word.slice(0, -1) : word}`, seconds, now)
}

/** A window centred on a moment — what you want when something
 *  happened at 14:35 and you need to see either side of it. */
export function aroundRange(at: Date, value: number, unitSecs: number): TimeRange {
  const half = value * unitSecs * 1000
  return {
    label: `Around ${at.toLocaleString()}`,
    since: new Date(at.getTime() - half).toISOString(),
    until: new Date(at.getTime() + half).toISOString(),
  }
}

/** The value a <input type="datetime-local"> wants, in local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Whether a moment falls inside a range, for the tables that hold
 * their whole list and filter in the browser.
 *
 * The gateway's log is paged server-side because it has half a million
 * rows; an audit log or a backup list is loaded whole and can be
 * narrowed here — same picker, same vocabulary, different place the
 * work happens.
 *
 * Accepts what the API happens to send: unix seconds, or an ISO
 * string. A row with no timestamp at all stays IN, because a range is
 * a filter on when something happened and not a claim that everything
 * has a when — hiding rows for lacking a field the user didn't ask
 * about is a filter doing something nobody requested.
 */
export function inRange(range: TimeRange, at: number | string | undefined | null): boolean {
  if (!range.since && !range.until) return true
  if (at === undefined || at === null || at === '') return true
  const ms = typeof at === 'number' ? at * 1000 : new Date(at).getTime()
  if (!Number.isFinite(ms)) return true
  if (range.since && ms < new Date(range.since).getTime()) return false
  if (range.until && ms > new Date(range.until).getTime()) return false
  return true
}
