import { rankOf } from './severity'

/**
 * Turning a host's vulnerabilities into the short list of things
 * somebody actually updates.
 *
 * A machine with four hundred CVEs has, in practice, half a dozen
 * pieces of software behind them. That collapse is computable, so it is
 * computed: the counts, versions and severities all come from the
 * inventory service, and no version is suggested that nobody reported.
 */

/**
 * Compares two reported OS strings of the same family, returning true
 * when b is newer than a.
 *
 * Only the trailing numbers are compared, and only when both sides
 * share the same leading words — "macOS 26.2" against "macOS 26.6.2",
 * never against "Ubuntu 24.04". A string that doesn't parse returns
 * false, so an unfamiliar format produces no claim rather than a wrong
 * one.
 */
export function isNewerOS(a: string, b: string): boolean {
  const parse = (s: string) => {
    const m = s.match(/^(.*?)([\d.]+)\s*(LTS)?$/)
    if (!m) return null
    return { family: m[1].trim(), parts: m[2].split('.').filter(Boolean).map(Number) }
  }
  const left = parse(a)
  const right = parse(b)
  if (!left || !right || left.family !== right.family) return false
  if (left.parts.some(Number.isNaN) || right.parts.some(Number.isNaN)) return false
  for (let i = 0; i < Math.max(left.parts.length, right.parts.length); i++) {
    const x = left.parts[i] ?? 0
    const y = right.parts[i] ?? 0
    if (x !== y) return y > x
  }
  return false
}

/** The newest OS of this host's own family seen anywhere in the estate. */
export function newestOSInEstate(
  osVersion: string,
  all: { osVersion: string }[],
): string | null {
  let newest = osVersion
  for (const h of all) {
    if (isNewerOS(newest, h.osVersion)) newest = h.osVersion
  }
  return newest === osVersion ? null : newest
}

/**
 * One piece of software that needs updating, however many rows the
 * inventory service split it into.
 */
/** One flaw behind a row's count. */
export interface RemediationCVE {
  cve: string
  severity: string
  cvssScore: number
  knownExploited: boolean
  /** Empty when no fixed version has been published. */
  resolvedInVersion: string
}

export interface Installed {
  name: string
  version: string
  /** Worst severity among its CVEs, '' when none of them is scored. */
  severity: string
  /** That severity's score, for ordering within a band. */
  worstScore: number
  /** Something you open, or something other things run on. */
  kind: 'application' | 'runtime'
  count: number
  /** What this is, ignoring which version — used to keep the versions
   *  of one thing together in the list. */
  product: string
  /** Distinct CVEs across every row that is this same software. */
  /** The CVEs behind `count`, worst first — what the row expands to
   *  show. Carried rather than re-derived, because the grouping that
   *  produced the count is the only thing that knows which rows fed
   *  it: a Windows installer's ten components are one product here. */
  cves: RemediationCVE[]
  /** Every copy of it is in the Trash. Still on disk, still carrying
   *  its flaws, and fixed by emptying the Trash rather than by
   *  updating anything — so it is listed, but the remedy differs. */
  discarded: boolean
}

/**
 * Whether this is something a person opens or something that sits
 * underneath what they open.
 *
 * Anything a package manager installed is a library by definition —
 * that part is data, not judgement. The name list is only for runtimes
 * that install like an application, which on Windows is most of them:
 * Python registers as an installed program exactly as Blender does, and
 * nothing in the record distinguishes them.
 *
 * The split exists because the two ask different things of a person.
 * Updating Edge is a click; updating a Python that four other things
 * import is a decision.
 */
const runtimeSources = [
  'python_packages',
  'npm_packages',
  'homebrew_packages',
  'deb_packages',
  'rpm_packages',
  'pacman_packages',
]
const runtimeNames = [
  'python',
  'node',
  'nodejs',
  'openjdk',
  'java',
  'jre',
  'jdk',
  'ruby',
  'perl',
  'php',
  'openssl',
  'dotnet',
  '.net',
  'go programming language',
]

export function softwareKind(name: string, source: string): 'application' | 'runtime' {
  if (runtimeSources.includes(source)) return 'runtime'
  const n = name.toLowerCase()
  return runtimeNames.some((r) => n.startsWith(r)) ? 'runtime' : 'application'
}

/** cpe:2.3:a:vendor:product:version:… — the product field, or "". */
function cpeProduct(cpe: string): string {
  const parts = cpe.split(':')
  return parts.length > 5 ? parts[4] : ''
}

/**
 * Collapses a host's vulnerable packages into the things you'd actually
 * update.
 *
 * A WINDOWS INSTALLER REGISTERS ITS COMPONENTS SEPARATELY, so one
 * Python shows up as ten rows — "Core Interpreter", "pip Bootstrap",
 * "Tcl/Tk Support" — each carrying the same CVEs. Listed raw that's
 * forty lines saying four things, and the counts read as ten times the
 * flaws that exist. Their names share nothing a string comparison could
 * use, but their CPEs all name the same product, which is what this
 * groups on.
 *
 * Keyed by product AND version, because three Pythons installed side by
 * side are three things to update, not one. Where no CPE matched, the
 * name stands in — an unrecognised package stays its own row rather
 * than being merged into something it might not be.
 */
export function installedNeedingUpdate(
  packages: {
    name: string
    version: string
    cpe: string
    source: string
    vulnerabilities:
      | {
          cve: string
          severity: string
          cvssScore: number
          knownExploited?: boolean
          resolvedInVersion?: string
        }[]
      | null
    discarded?: boolean
  }[],
): Installed[] {
  const groups = new Map<
    string,
    {
      names: string[]
      version: string
      product: string
      source: string
      cves: Map<string, RemediationCVE>
      severity: string
      worstScore: number
      discarded: boolean
    }
  >()
  for (const p of packages) {
    const vulns = p.vulnerabilities ?? []
    if (vulns.length === 0) continue
    const product = cpeProduct(p.cpe) || p.name
    const key = `${product}\u0000${p.version}`
    const group =
      groups.get(key) ??
      {
        names: [],
        version: p.version,
        product,
        source: p.source,
        cves: new Map<string, RemediationCVE>(),
        severity: '',
        worstScore: 0,
        // A group is discarded only if EVERY row in it is. One live
        // copy makes the whole product live, which is the safe
        // direction: excusing a real flaw is worse than mentioning a
        // trashed one.
        discarded: true,
      }
    group.names.push(p.name)
    if (!p.discarded) group.discarded = false
    for (const v of vulns) {
      // Keyed by CVE, because the same flaw arrives once per component
      // of a product that ships as several packages.
      group.cves.set(v.cve, {
        cve: v.cve,
        severity: v.severity,
        cvssScore: v.cvssScore,
        knownExploited: Boolean(v.knownExploited),
        resolvedInVersion: v.resolvedInVersion ?? '',
      })
      // AN APP IS AS BAD AS ITS WORST FLAW. One critical among fifty
      // lows is a critical; counting instead would bury it under
      // something harmless and numerous.
      if (rankOf(v.severity) < rankOf(group.severity)) {
        group.severity = v.severity
      }
      group.worstScore = Math.max(group.worstScore, v.cvssScore)
    }
    groups.set(key, group)
  }
  const items = [...groups.values()].map((g) => {
    // The shortest name is the product itself; the longer ones are its
    // components ("Python 3.13.3 (64-bit)" over "… Core Interpreter").
    const name = g.names.reduce((a, b) => (b.length < a.length ? b : a))
    return {
      name,
      // Windows installers put the version in the name, so printing it
      // again gave "Python 3.13.3 (64-bit) 3.13.3".
      version: name.includes(g.version) ? '' : g.version,
      product: g.product,
      severity: g.severity,
      worstScore: g.worstScore,
      kind: softwareKind(name, g.source),
      count: g.cves.size,
      // WORST FIRST, and known-exploited above everything: the reason
      // to open a row is to find the one that matters, not to read an
      // alphabetical list.
      cves: [...g.cves.values()].sort(
        (a, b) =>
          Number(b.knownExploited) - Number(a.knownExploited) ||
          rankOf(a.severity) - rankOf(b.severity) ||
          b.cvssScore - a.cvssScore ||
          a.cve.localeCompare(b.cve),
      ),
      discarded: g.discarded,
    }
  })

  // RANKED BY THE WORST THING IN IT, not by how many. An app carrying
  // one critical among fifty lows is a critical; counting instead
  // buried it under something harmless and numerous.
  //
  // And the versions of one product stay together — sorting each on its
  // own scattered them, giving Python 3.13.3, Python 3.12.10, Visual
  // Studio Code, then Python 3.14.6, which reads as three problems
  // rather than one thing installed three times. The product's worst
  // severity leads, its other versions follow. Computed over the whole
  // list first, because a pairwise comparator can't see it.
  const worst = new Map<string, number>()
  const worstScore = new Map<string, number>()
  for (const i of items) {
    worst.set(i.product, Math.min(worst.get(i.product) ?? 99, rankOf(i.severity)))
    worstScore.set(i.product, Math.max(worstScore.get(i.product) ?? 0, i.worstScore))
  }
  return items.sort(
    (a, b) =>
      (worst.get(a.product) ?? 99) - (worst.get(b.product) ?? 99) ||
      (worstScore.get(b.product) ?? 0) - (worstScore.get(a.product) ?? 0) ||
      a.product.localeCompare(b.product) ||
      rankOf(a.severity) - rankOf(b.severity) ||
      b.count - a.count ||
      a.name.localeCompare(b.name),
  )
}
