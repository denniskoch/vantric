/**
 * Brand marks for the things this console talks to. simple-icons
 * ships the paths (CC0); they're rendered inline by BrandIcon.
 *
 * Everything here is a lookup from a string the backend already
 * reports — an engine type, a version banner, an OS name, a file name
 * — so no API had to grow a field to get a logo on screen.
 */
import {
  siAdguard,
  siAnthropic,
  siApple,
  siAlmalinux,
  siAlpinelinux,
  siArchlinux,
  siAuthelia,
  siAuthentik,
  siCentos,
  siClaude,
  siCloudflare,
  siDebian,
  siDeepseek,
  siElevenlabs,
  siFedora,
  siForgejo,
  siFreebsd,
  siGitea,
  siGooglegemini,
  siGrafana,
  siHomeassistant,
  siHuggingface,
  siImmich,
  siJellyfin,
  siKeycloak,
  siLinux,
  siMealie,
  siMinio,
  siMariadb,
  siMistralai,
  siMysql,
  siNextcloud,
  siNetbsd,
  siNixos,
  siOpenbsd,
  siOllama,
  siOpenrouter,
  siOpensuse,
  siOpnsense,
  siPaperlessngx,
  siPfsense,
  siPihole,
  siPlex,
  siPortainer,
  siPostgresql,
  siProxmox,
  siRedhat,
  siRockylinux,
  siSynology,
  siTailscale,
  siTruenas,
  siUbuntu,
  siUptimekuma,
  siVaultwarden,
} from 'simple-icons'
import type { SimpleIcon } from 'simple-icons'
import type { SvgIconComponent } from '@mui/icons-material'
import TerminalIcon from '@mui/icons-material/Terminal'
import HandymanIcon from '@mui/icons-material/Handyman'
import SmartToyIcon from '@mui/icons-material/SmartToy'

/**
 * Marks drawn here rather than taken from simple-icons, in the same
 * `{ title, hex, path }` shape BrandIcon renders.
 *
 * This is the exception to "brand marks come from simple-icons", and it
 * exists for one reason: simple-icons carries no Microsoft marks — they
 * were removed over trademark policy, not because nobody wanted them —
 * and a console that manages Windows guests can't leave the commonest
 * guest OS in the lab as a blank column. The flag below is the plain
 * four-pane geometry, drawn from scratch.
 */
const siWindows: SimpleIcon = {
  title: 'Windows',
  slug: 'windows',
  hex: '0078D4',
  source: '',
  svg: '',
  path:
    'M0 3.449 9.75 2.1v9.451H0zm10.949-1.6L24 0v11.4H10.949zM0 12.6h9.75v9.451L0 20.699zm10.949 0H24V24l-13.051-1.801z',
} as SimpleIcon

/** MySQL and MariaDB share an engine type; the version banner is what
 *  tells them apart, so a MariaDB server gets its own seal. */
export function databaseBrand(engine: string, version?: string): SimpleIcon | null {
  if (engine === 'postgres') return siPostgresql
  if (engine === 'mysql') {
    return version?.toLowerCase().includes('mariadb') ? siMariadb : siMysql
  }
  return null
}

export function hypervisorBrand(type: string): SimpleIcon | null {
  return type === 'proxmox' ? siProxmox : null
}

export function dnsBrand(type: string): SimpleIcon | null {
  return type === 'cloudflare' ? siCloudflare : null
}

const identityBrands: Record<string, SimpleIcon> = {
  authentik: siAuthentik,
  authelia: siAuthelia,
  keycloak: siKeycloak,
}

export function identityBrand(type: string): SimpleIcon | null {
  return identityBrands[type] ?? null
}

/**
 * The model providers an AI gateway routes to, keyed on the name the
 * gateway itself reports.
 *
 * THREE OF THEM HAVE NO MARK HERE, and that is simple-icons' answer
 * rather than an oversight: OpenAI, xAI and Cerebras aren't in the set.
 * They fall back to the neutral glyph, the same way an OS with no
 * legible mark does — and deliberately NOT to a lookalike. X's mark is
 * not xAI's, and drawing OpenAI's knot from memory would put a wrong
 * logo next to a real provider, which is worse than a grey square. The
 * hand-drawn Windows exception above is a flag of four parallelograms;
 * this isn't that.
 */
const aiProviderBrands: Record<string, SimpleIcon> = {
  anthropic: siAnthropic,
  claude: siClaude,
  ollama: siOllama,
  mistral: siMistralai,
  deepseek: siDeepseek,
  huggingface: siHuggingface,
  openrouter: siOpenrouter,
  elevenlabs: siElevenlabs,
  google: siGooglegemini,
  gemini: siGooglegemini,
  vertex: siGooglegemini,
}

/** Same answer shape as osMark: a mark, a glyph, or nothing — so a
 *  caller doesn't have to ask twice to find out there isn't one. */
export function aiProviderMark(name: string): OSMark | null {
  const key = name.trim().toLowerCase()
  if (!key) return null
  const brand = aiProviderBrands[key]
  if (brand) return { kind: 'brand', icon: brand }
  // OpenAI, xAI, Cerebras and anything else the gateway routes to.
  // A glyph says "a model provider" without pretending to be a logo.
  return { kind: 'glyph', icon: SmartToyIcon }
}

// The services an identity provider fronts. Matched on the
// application's own name, so this needs no API field — and a service
// simple-icons doesn't carry (Headscale, Linkwarden, Open WebUI …)
// simply has no mark rather than a wrong one.
const appBrands: [RegExp, SimpleIcon][] = [
  [/forgejo/i, siForgejo],
  [/gitea/i, siGitea],
  [/paperless/i, siPaperlessngx],
  [/mealie/i, siMealie],
  [/synology/i, siSynology],
  [/proxmox/i, siProxmox],
  [/tailscale|headscale/i, siTailscale],
  [/nextcloud/i, siNextcloud],
  [/jellyfin/i, siJellyfin],
  [/plex/i, siPlex],
  [/grafana/i, siGrafana],
  [/home.?assistant/i, siHomeassistant],
  [/immich/i, siImmich],
  [/vaultwarden|bitwarden/i, siVaultwarden],
  [/portainer/i, siPortainer],
  [/minio/i, siMinio],
  [/truenas/i, siTruenas],
  [/opnsense/i, siOpnsense],
  [/pi.?hole/i, siPihole],
  [/adguard/i, siAdguard],
  [/uptime.?kuma/i, siUptimekuma],
  [/cloudflare/i, siCloudflare],
  [/postgres/i, siPostgresql],
]

export function appBrand(name: string): SimpleIcon | null {
  if (!name) return null
  return appBrands.find(([pattern]) => pattern.test(name))?.[1] ?? null
}

// Matched against anything that names an OS: a guest agent's report
// ("Ubuntu 24.04.1 LTS"), a cloud image file, a CT template, an ISO.
// Order matters — "rocky" and "alma" must be tried before the generic
// Linux fallback, and "centos" before "os" substrings.
const osBrands: [RegExp, SimpleIcon][] = [
  [/ubuntu/i, siUbuntu],
  [/debian/i, siDebian],
  [/alpine/i, siAlpinelinux],
  [/fedora/i, siFedora],
  [/arch/i, siArchlinux],
  [/rocky/i, siRockylinux],
  [/alma/i, siAlmalinux],
  [/opensuse|suse|sles/i, siOpensuse],
  [/centos/i, siCentos],
  [/rhel|red\s?hat/i, siRedhat],
  [/nixos/i, siNixos],
  // Windows names itself several ways: a guest agent says "Microsoft
  // Windows 11 Pro", an ISO says "Win11", and Proxmox's own osType is
  // win7…win11, wxp or w2k8. A bare "win" is deliberately not enough —
  // it would put a Windows flag on Darwin and on virtio-win drivers.
  [/windows|\bwin(?:7|8|10|11|nt)\b|\bwxp\b|\bw2k\d*\b/i, siWindows],
  // Firewall appliances before the BSDs they're built on, or pfSense
  // reads as FreeBSD.
  [/pfsense/i, siPfsense],
  [/opnsense/i, siOpnsense],
  [/freebsd/i, siFreebsd],
  [/openbsd/i, siOpenbsd],
  [/netbsd/i, siNetbsd],
  [/proxmox|\bpve\b|\bpbs\b/i, siProxmox],
  [/truenas|freenas/i, siTruenas],
  // An inventory service brings laptops with it, so the marks have to
  // cover what people carry as well as what the lab runs.
  [/macos|mac os|osx|darwin/i, siApple],
  [/linux/i, siLinux],
]

// Where no legible mark exists, a glyph says what kind of thing this is
// instead of showing a wrong logo or nothing at all. A terminal for the
// DOS-era systems nobody draws marks for; a tool for media that isn't
// an operating system — driver disks, rescue images, virtio — and for
// VMware, whose only mark is a wordmark that turns to grey mush at the
// 16px a table row gives it.
const osGlyphs: [RegExp, SvgIconComponent][] = [
  [/virtio|driver|rescue|gparted|clonezilla|memtest|\butil/i, HandymanIcon],
  [/vmware|esxi|vsphere|photon/i, HandymanIcon],
  [/freedos|ms.?dos|\bdos\b|novell|netware/i, TerminalIcon],
]

/** What to draw beside a name: a brand mark, a glyph for the things no
 *  icon set carries, or nothing. One lookup, one answer — a caller
 *  shouldn't have to ask twice to find out there's no mark. */
export type OSMark =
  | { kind: 'brand'; icon: SimpleIcon }
  | { kind: 'glyph'; icon: SvgIconComponent }

export function osMark(name: string): OSMark | null {
  if (!name) return null
  const brand = osBrands.find(([pattern]) => pattern.test(name))?.[1]
  if (brand) return { kind: 'brand', icon: brand }
  const glyph = osGlyphs.find(([pattern]) => pattern.test(name))?.[1]
  return glyph ? { kind: 'glyph', icon: glyph } : null
}
