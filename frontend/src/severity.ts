/**
 * Rendering a CVSS severity, including the case where there isn't one.
 *
 * Shared because two tables show this and they were free to disagree.
 * The important part is the absent case: an unscored CVE used to print
 * "MINIMAL 0.0" — the least alarming words available — over flaws
 * nobody had assessed. Fleet sends 0.0 when it has no score, which on a
 * free tier is most rows, so the label was wrong precisely where it
 * mattered: the three CVEs CISA lists as actively exploited sat at the
 * top of the list marked MINIMAL.
 *
 * Unknown is now said as unknown, and sorts after everything real
 * rather than below LOW — "we haven't looked" is not a reassurance.
 */
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL' | ''

export const severityRank: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  MINIMAL: 4,
}

export const severityColor: Record<string, string> = {
  CRITICAL: '#d93025',
  HIGH: '#d93025',
  MEDIUM: '#e37400',
  LOW: '#5f6368',
  MINIMAL: '#5f6368',
}

/** Where a severity sorts. Unknown goes last, not lowest. */
export function rankOf(severity: string): number {
  return severityRank[severity] ?? 9
}

/**
 * What the cell should say. A score of 0 means the service has none —
 * CVSS 0.0 (NONE) is real but no source here distinguishes the two, and
 * of the two possible mistakes only one is dangerous.
 */
export function severityLabel(severity: string, score: number): string | null {
  if (!severity || score <= 0) return null
  return `${severity} ${score.toFixed(1)}`
}
