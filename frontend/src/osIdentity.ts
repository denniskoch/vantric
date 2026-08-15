/**
 * Working out what a template actually is, from what it's called.
 *
 * A boot-disk picker needs two things a raw name doesn't give you:
 * which operating system this is, and which version. Both are almost
 * always sitting in the name already — `debian-13-cloudinit`,
 * `noble-server-cloudimg-amd64` — so they're derived rather than
 * stored. Derivation can't go stale and needs nobody to maintain a
 * second copy; a stored display name goes wrong the first time
 * somebody renames a template in Proxmox.
 *
 * Where the name says nothing useful (`k8s-base`), the answer is
 * "unknown" and the template lands under Other. The two ways to fix
 * that are both on the object itself: write a first line in the
 * description, or tag it `os-debian`.
 */

export interface OSIdentity {
  /** The family a picker groups by: Debian, Ubuntu, Rocky Linux… */
  family: string
  /** "13", "24.04" — empty when the name doesn't say. */
  version: string
  /** "trixie", "noble" — empty unless known. */
  codename: string
  /** What a person would call it: "Debian GNU/Linux 13 (trixie)". */
  label: string
}

/**
 * Releases worth naming. This is the one table that needs a line
 * adding when a distribution ships — the same maintenance as the brand
 * marks, and the same failure if it's forgotten: a version with no
 * codename, never a wrong one.
 */
const codenames: Record<string, Record<string, string>> = {
  Debian: { '10': 'buster', '11': 'bullseye', '12': 'bookworm', '13': 'trixie', '14': 'forky' },
  Ubuntu: {
    '20.04': 'focal',
    '22.04': 'jammy',
    '24.04': 'noble',
    '24.10': 'oracular',
    '25.04': 'plucky',
    '26.04': 'resolute',
  },
}

/** Ubuntu names its images after the codename far more often than the
 *  number, so the lookup has to work both ways. */
const ubuntuByCodename: Record<string, string> = Object.fromEntries(
  Object.entries(codenames.Ubuntu).map(([version, codename]) => [codename, version]),
)

/** The full name a distribution gives itself, where it differs from
 *  the family word people actually say. */
const properNames: Record<string, string> = {
  Debian: 'Debian GNU/Linux',
  Rocky: 'Rocky Linux',
  Alma: 'AlmaLinux',
  Alpine: 'Alpine Linux',
  RHEL: 'Red Hat Enterprise Linux',
  Arch: 'Arch Linux',
}

/**
 * Image names drop the dot: `alpine-321` is 3.21 and `ubuntu-2404` is
 * 24.04. Both are read as "first component, then the rest", which is
 * how the names are built — the alternative is reporting Alpine 321.
 */
function unpackVersion(digits: string, majorLength: number): string {
  if (!digits || digits.includes('.')) return digits
  if (digits.length <= majorLength) return digits
  return `${digits.slice(0, majorLength)}.${digits.slice(majorLength)}`
}

interface Matcher {
  family: string
  pattern: RegExp
  /** Pulls a version out of the match, when the pattern found one. */
  version?: (m: RegExpMatchArray) => string
}

// Order matters for the same reason it does in the brand table:
// appliances before the systems they're built on, and anything
// specific before a generic word that would swallow it.
const matchers: Matcher[] = [
  { family: 'pfSense', pattern: /pfsense[-_ ]?(\d+\.\d+(?:\.\d+)?)?/i, version: (m) => m[1] ?? '' },
  { family: 'OPNsense', pattern: /opnsense[-_ ]?(\d+\.\d+)?/i, version: (m) => m[1] ?? '' },
  { family: 'Debian', pattern: /debian[-_ ]?(\d+)?/i, version: (m) => m[1] ?? '' },
  {
    family: 'Ubuntu',
    // Two-digit year, two-digit month: 2404 is 24.04.
    pattern: /ubuntu[-_ ]?(\d{2})\.?(\d{2})?/i,
    version: (m) => (m[2] ? `${m[1]}.${m[2]}` : m[1] ?? ''),
  },
  { family: 'Rocky', pattern: /rocky[-_ ]?(\d+)?/i, version: (m) => m[1] ?? '' },
  { family: 'Alma', pattern: /alma(?:linux)?[-_ ]?(\d+)?/i, version: (m) => m[1] ?? '' },
  { family: 'CentOS', pattern: /centos[-_ ]?(\d+)?/i, version: (m) => m[1] ?? '' },
  { family: 'RHEL', pattern: /rhel[-_ ]?(\d+)?|red\s?hat/i, version: (m) => m[1] ?? '' },
  { family: 'Fedora', pattern: /fedora[-_ ]?(\d+)?/i, version: (m) => m[1] ?? '' },
  {
    family: 'Alpine',
    // Single-digit major: 321 is 3.21.
    pattern: /alpine[-_ ]?(\d+(?:\.\d+)?)/i,
    version: (m) => unpackVersion(m[1] ?? '', 1),
  },
  { family: 'openSUSE', pattern: /opensuse|suse|sles/i },
  { family: 'Arch', pattern: /arch(?:linux)?/i },
  { family: 'NixOS', pattern: /nixos[-_ ]?(\d+\.\d+)?/i, version: (m) => m[1] ?? '' },
  { family: 'FreeBSD', pattern: /freebsd[-_ ]?(\d+\.\d+)?/i, version: (m) => m[1] ?? '' },
  { family: 'OpenBSD', pattern: /openbsd[-_ ]?(\d+\.\d+)?/i, version: (m) => m[1] ?? '' },
  {
    family: 'Windows Server',
    pattern: /win(?:dows)?[-_ ]?(?:server)?[-_ ]?(2012|2016|2019|2022|2025)\b|\bw2k(\d+)\b/i,
    version: (m) => m[1] ?? (m[2] ? `20${m[2]}` : ''),
  },
  {
    family: 'Windows',
    pattern: /win(?:dows)?[-_ ]?(7|8|10|11)\b/i,
    version: (m) => m[1] ?? '',
  },
  { family: 'Windows', pattern: /windows|\bwxp\b|\bwin(?:nt)\b/i },
]

/** Ubuntu images are usually named for the codename alone. */
function ubuntuFromCodename(name: string): OSIdentity | null {
  for (const [codename, version] of Object.entries(ubuntuByCodename)) {
    if (new RegExp(`\\b${codename}\\b`, 'i').test(name)) {
      return identity('Ubuntu', version, codename)
    }
  }
  return null
}

function identity(family: string, version: string, codename?: string): OSIdentity {
  const known = codename ?? codenames[family]?.[version] ?? ''
  const proper = properNames[family] ?? family
  const label = [proper, version, known && `(${known})`].filter(Boolean).join(' ')
  return { family, version, codename: known, label }
}

/** What this template is, as far as its name gives it away. */
export function osIdentity(name: string): OSIdentity | null {
  if (!name) return null
  for (const matcher of matchers) {
    const match = name.match(matcher.pattern)
    if (match) return identity(matcher.family, matcher.version?.(match) ?? '')
  }
  return ubuntuFromCodename(name)
}

/**
 * A tag is the escape hatch for templates whose name says nothing:
 * `os-debian` puts one in the Debian group without renaming anything.
 */
export function osFromTags(tags: string[] | null | undefined): OSIdentity | null {
  for (const tag of tags ?? []) {
    const value = tag.replace(/^os[-_]/i, '')
    if (value !== tag) {
      const derived = osIdentity(value)
      if (derived) return derived
    }
  }
  return null
}

/** Everything a picker shows about one template. */
export interface TemplateIdentity extends OSIdentity {
  /** The name to show: a written label wins over a derived one. */
  title: string
  /** Whether the title came from someone writing it down. */
  written: boolean
  /** Description below the first line, where there is any. */
  notes: string
}

/**
 * Resolves what to call a template.
 *
 * The first line of the description wins, because it's the one thing a
 * person wrote on purpose. Otherwise the name is read. Failing both,
 * the template is shown under its own name and grouped as Other —
 * which is honest, and fixable by writing that first line.
 */
export function templateIdentity(template: {
  name: string
  description?: string
  tags?: string[] | null
}): TemplateIdentity {
  const [firstLine, ...rest] = (template.description ?? '').split('\n')
  const written = firstLine.trim()
  const derived = osIdentity(template.name) ?? osFromTags(template.tags) ?? osIdentity(written)
  return {
    family: derived?.family ?? 'Other',
    version: derived?.version ?? '',
    codename: derived?.codename ?? '',
    label: derived?.label ?? '',
    // A derived label only becomes the title when it carries a version
    // — "Debian GNU/Linux 13 (trixie)" says more than the file name,
    // where a bare "Debian GNU/Linux" says less. That bare case is
    // what an os- tag produces on a template named for its job
    // (k8s-node-base), and renaming it Debian would be a lie about
    // what it's for.
    title: written || (derived?.version ? derived.label : template.name),
    written: Boolean(written),
    notes: rest.join('\n').trim(),
  }
}
