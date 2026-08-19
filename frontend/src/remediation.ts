/**
 * Turning a host's vulnerabilities into the short list of things
 * somebody actually does.
 *
 * A machine with four hundred CVEs has, in practice, half a dozen
 * actions: update the OS, run one vendor updater, open the App Store,
 * throw away something ancient. That collapse is computable, so it is
 * computed — the counts and versions here all come from the inventory
 * service, and nothing is inferred about a version nobody reported.
 *
 * What IS knowledge rather than data is how a given application gets
 * updated on a given platform, and that is a small static mapping
 * below. It is deliberately shallow: anything unrecognised falls to
 * "update from the vendor", which is true of everything and useful for
 * nothing, rather than guessing at a channel that might not exist.
 */

/** How a piece of software gets updated. Order is the order to do it. */
export type UpdateRoute = {
  key: string
  /** What to do, as an instruction. */
  label: string
  /** Why these are grouped, where it isn't obvious. */
  note?: string
}

const OS_BUNDLED: UpdateRoute = {
  key: 'os',
  label: 'Updated with the operating system',
  note: 'These ship with the OS, so the system update above covers them.',
}
const APP_STORE: UpdateRoute = { key: 'appstore', label: 'Update from the App Store' }
const MS_AUTOUPDATE: UpdateRoute = {
  key: 'msau',
  label: 'Update with Microsoft AutoUpdate',
}
const WINDOWS_UPDATE: UpdateRoute = { key: 'wu', label: 'Update with Windows Update' }
const PACKAGE_MANAGER: UpdateRoute = {
  key: 'pkg',
  label: "Update with the system's package manager",
}
const VENDOR: UpdateRoute = { key: 'vendor', label: 'Update from the vendor' }

/** Apple software that updates with macOS rather than separately. */
const macOSBundled = ['safari', 'webkit']
/** Apple's own apps, which come through the App Store. */
const appleAppStore = ['keynote', 'pages', 'numbers', 'imovie', 'garageband', 'xcode']

export function updateRoute(platform: string, name: string): UpdateRoute {
  const app = name.toLowerCase()
  if (platform === 'darwin') {
    if (macOSBundled.some((n) => app.startsWith(n))) return OS_BUNDLED
    if (appleAppStore.some((n) => app.startsWith(n))) return APP_STORE
    if (app.startsWith('microsoft')) return MS_AUTOUPDATE
    return VENDOR
  }
  if (platform === 'windows') {
    // Defender and Edge come down Windows Update; other Microsoft apps
    // may not, so this stays narrow.
    if (app.includes('defender') || app.startsWith('windows ')) return WINDOWS_UPDATE
    return VENDOR
  }
  // Everything else here is Linux, where the answer is the same for
  // essentially all of it.
  return PACKAGE_MANAGER
}

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
export interface Installed {
  name: string
  version: string
  /** Distinct CVEs across every row that is this same software. */
  count: number
  route: UpdateRoute
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
  platform: string,
  packages: { name: string; version: string; cpe: string; vulnerabilities: { cve: string }[] | null }[],
): Installed[] {
  const groups = new Map<string, { names: string[]; version: string; cves: Set<string> }>()
  for (const p of packages) {
    const vulns = p.vulnerabilities ?? []
    if (vulns.length === 0) continue
    const product = cpeProduct(p.cpe) || p.name
    const key = `${product}\u0000${p.version}`
    const group = groups.get(key) ?? { names: [], version: p.version, cves: new Set<string>() }
    group.names.push(p.name)
    for (const v of vulns) group.cves.add(v.cve)
    groups.set(key, group)
  }
  return [...groups.values()]
    .map((g) => {
      // The shortest name is the product itself; the longer ones are
      // its components ("Python 3.13.3 (64-bit)" over "… Core
      // Interpreter (64-bit)").
      const name = g.names.reduce((a, b) => (b.length < a.length ? b : a))
      return { name, version: g.version, count: g.cves.size, route: updateRoute(platform, name) }
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}
