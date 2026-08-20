/**
 * A link built from somebody else's data.
 *
 * Three pages render an href straight from a string this console was
 * handed: NVD's reference list and CVE details page, and the launch URL
 * authentik publishes for an application. React does not sanitise an
 * href — `javascript:alert(1)` in one of those fields is a link that
 * runs it, on click, with the session sitting right there.
 *
 * None of this is a live exploit today: NVD is a public reference nobody
 * writes to, and authentik's applications are configured by whoever runs
 * it. But both are values this app renders without ever having chosen
 * them, and "the upstream is trustworthy" is a property of today rather
 * than a property of the code.
 *
 * Only http and https pass. Deliberately NOT a general "is this scheme
 * safe" helper: the console builds `rdp://` links to hand a guest to the
 * desktop's own client, and those are ours and correct — the rule here
 * is narrow because the question is narrow.
 */
export function externalHref(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  let parsed: URL
  try {
    parsed = new URL(value, window.location.origin)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  return parsed.href
}
