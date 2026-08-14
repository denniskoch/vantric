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
  siAlmalinux,
  siAlpinelinux,
  siArchlinux,
  siAuthelia,
  siAuthentik,
  siCentos,
  siCloudflare,
  siDebian,
  siFedora,
  siForgejo,
  siFreebsd,
  siGitea,
  siGrafana,
  siHomeassistant,
  siImmich,
  siJellyfin,
  siKeycloak,
  siLinux,
  siMealie,
  siMinio,
  siMariadb,
  siMysql,
  siNextcloud,
  siNixos,
  siOpensuse,
  siOpnsense,
  siPaperlessngx,
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
  [/freebsd/i, siFreebsd],
  [/linux/i, siLinux],
]

/** The brand for anything that names an operating system, or null when
 *  nothing matches — a Windows image, say, which simple-icons doesn't
 *  carry a mark for. */
export function osBrand(name: string): SimpleIcon | null {
  if (!name) return null
  return osBrands.find(([pattern]) => pattern.test(name))?.[1] ?? null
}
