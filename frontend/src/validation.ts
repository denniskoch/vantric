/**
 * Field validation shared by the forms.
 *
 * Each helper returns an error message or null, and returns null for an
 * empty value: a field you haven't typed in yet isn't wrong, it's
 * untouched. Fields show the message (and turn red) as soon as the
 * value is invalid, so a disabled submit button is never the only clue
 * that something needs fixing.
 */

/** Resource names: lowercase, digits, hyphens, starting with a letter. */
export const resourceNameRe = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/

export function resourceNameError(value: string): string | null {
  if (!value) return null
  if (!resourceNameRe.test(value)) {
    return value !== value.toLowerCase()
      ? 'Use lowercase only — no capital letters'
      : 'Lowercase letters, numbers and hyphens, starting with a letter'
  }
  return null
}

export const domainRe = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

export function domainError(value: string): string | null {
  const domain = value.trim().toLowerCase()
  if (!domain) return null
  if (/^https?:\/\//.test(domain)) return 'Enter just the domain, without http:// or https://'
  if (domain.endsWith('.')) return 'Leave off the trailing dot'
  if (!domain.includes('.')) return 'Include the full domain, e.g. example.com'
  if (!domainRe.test(domain)) return 'Enter a domain like example.com'
  return null
}

export function urlError(value: string): string | null {
  if (!value.trim()) return null
  if (!/^https?:\/\/\S+$/.test(value.trim())) {
    return 'Must be a full http:// or https:// address'
  }
  return null
}

/**
 * The name part of a DNS record, relative to its zone: blank or "@"
 * for the apex, otherwise labels like "www" or "api.dev". Underscores
 * are allowed because names like _dmarc are ordinary.
 */
export function recordNameError(value: string): string | null {
  const name = value.trim().toLowerCase()
  if (!name || name === '@') return null
  if (name.endsWith('.')) return 'Leave off the trailing dot'
  if (name.includes(' ')) return 'Names cannot contain spaces'
  const labels = name.split('.')
  const bad = labels.some(
    (label, i) =>
      !(label === '*' && i === 0) &&
      !/^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/.test(label),
  )
  return bad ? 'Letters, numbers and hyphens, e.g. www or api.dev' : null
}

const isIPv4 = (value: string) => {
  const octets = value.split('.')
  return (
    octets.length === 4 &&
    octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)
  )
}

const isIPv6 = (value: string) => {
  const halves = value.split('::')
  if (halves.length > 2) return false
  const groups = halves.flatMap((half) => (half ? half.split(':') : []))
  // A trailing IPv4 part (::ffff:192.0.2.1) stands in for two groups.
  const tail = groups.at(-1)
  const embedded = Boolean(tail && tail.includes('.'))
  if (embedded && !isIPv4(tail!)) return false
  const rest = embedded ? groups.slice(0, -1) : groups
  if (rest.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return false
  const count = rest.length + (embedded ? 2 : 0)
  return halves.length === 2 ? count <= 7 : count === 8
}

/** A record's value, checked against what its type can hold. */
export function recordValueError(type: string, value: string): string | null {
  const content = value.trim()
  if (!content) return null
  switch (type) {
    case 'A':
      return isIPv4(content) ? null : 'Enter an IPv4 address, e.g. 192.0.2.91'
    case 'AAAA':
      return isIPv6(content) ? null : 'Enter an IPv6 address, e.g. 2001:db8::1'
    case 'CNAME':
    case 'MX':
    case 'NS':
    // A PTR's value is the name the address answers as — the one type
    // whose whole job is to point back at a hostname.
    case 'PTR': {
      const host = content.replace(/\.$/, '').toLowerCase()
      if (/^https?:\/\//.test(host)) return 'Enter just the hostname, without http:// or https://'
      return domainRe.test(host) ? null : 'Enter a hostname, e.g. mail.example.com'
    }
    default:
      return null
  }
}

/** A host to connect to: hostname, IPv4 or IPv6 literal. */
export function hostError(value: string): string | null {
  const host = value.trim()
  if (!host) return null
  if (/^https?:\/\//.test(host)) return 'Enter just the host, without http:// or https://'
  if (host.includes('/')) return 'Enter just the host, without a path'
  if (host.includes(':') && !host.startsWith('[')) {
    return isIPv6(host) ? null : 'Put the port in its own field, not after a colon'
  }
  const bare = host.replace(/^\[|\]$/g, '')
  if (isIPv4(bare) || isIPv6(bare)) return null
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(bare)
    ? null
    : 'Enter a hostname or IP address'
}

export function portError(value: number): string | null {
  if (!value) return null
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return 'Ports run from 1 to 65535'
  }
  return null
}

/**
 * Identifiers for databases and users. These reach DDL, which can't
 * take bind parameters, so the rule is deliberately narrow — the
 * backend enforces the same shape.
 */
export function identifierError(value: string): string | null {
  const name = value.trim()
  if (!name) return null
  if (!/^[A-Za-z_]/.test(name)) return 'Start with a letter or underscore'
  if (!/^[A-Za-z_][A-Za-z0-9_$-]*$/.test(name)) {
    return 'Use letters, digits, underscore or hyphen only'
  }
  if (name.length > 63) return 'Keep it under 64 characters'
  return null
}

/** Providers cap how short or long a TTL may be. */
export function ttlError(seconds: number): string | null {
  if (!seconds) return null
  if (seconds < 60) return 'Use at least 60 seconds, or switch to automatic'
  if (seconds > 86400) return 'Use at most 1 day (86,400 seconds)'
  return null
}

/** Filenames for datastore uploads/downloads. */
export function filenameError(value: string, extensions: RegExp, hint: string): string | null {
  const name = value.trim()
  if (!name) return null
  if (name.includes('/')) return 'Just the file name, without any path'
  if (!extensions.test(name)) return `Must end in ${hint}`
  return null
}

/**
 * An IPv4 network in CIDR form.
 *
 * Host bits are rejected rather than quietly masked: 192.168.80.7/24
 * is somebody typing a host where a network goes, and accepting it
 * would make every later "is this address inside that range" wrong.
 * The message says what they probably meant.
 */
export function ipv4CIDRError(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const [address, bits, ...rest] = trimmed.split('/')
  if (rest.length || bits === undefined) {
    return 'Use CIDR, for example 192.168.80.0/24'
  }
  const octets = ipv4Octets(address)
  if (!octets) return 'Not an IPv4 address'
  const prefix = Number(bits)
  if (!/^\d{1,2}$/.test(bits) || prefix > 32) return 'Prefix length must be 0–32'

  const value32 = octets.reduce((n, octet) => n * 256 + octet, 0)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (value32 & mask) >>> 0
  if (network !== value32) {
    const masked = [24, 16, 8, 0].map((shift) => (network >>> shift) & 255).join('.')
    return `Host bits set — did you mean ${masked}/${prefix}?`
  }
  return null
}

/** An IPv4 address, and optionally whether it sits inside a range. */
export function ipv4AddressError(value: string, withinCIDR?: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const octets = ipv4Octets(trimmed)
  if (!octets) return 'Not an IPv4 address'
  if (!withinCIDR || ipv4CIDRError(withinCIDR)) return null

  const [network, bits] = withinCIDR.trim().split('/')
  const netOctets = ipv4Octets(network)
  if (!netOctets) return null
  const prefix = Number(bits)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const toInt = (parts: number[]) => parts.reduce((n, octet) => n * 256 + octet, 0)
  if (((toInt(octets) & mask) >>> 0) !== ((toInt(netOctets) & mask) >>> 0)) {
    return `Not inside ${withinCIDR.trim()}`
  }
  return null
}

function ipv4Octets(value: string): number[] | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : NaN,
  )
  return octets.every((n) => n >= 0 && n <= 255) ? octets : null
}

/**
 * An 802.1Q VLAN ID. Blank means untagged, which is a real answer.
 *
 * 4095 is reserved and 4096 doesn't fit the 12-bit tag — the number
 * people reach for when they assume it goes to 4096.
 */
export function vlanIDError(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^\d{1,4}$/.test(trimmed)) return 'VLAN must be a number'
  const id = Number(trimmed)
  if (id < 1 || id > 4094) return 'VLAN must be between 1 and 4094'
  return null
}

/**
 * A VM name, as the hypervisor accepts it: a DNS label.
 *
 * Proxmox is stricter than it looks — an underscore or a leading
 * hyphen is refused at the API, and finding that out after the form
 * submits is worse than being told here.
 */
export function instanceNameError(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > 63) return 'Too long — 63 characters at most'
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(trimmed)) {
    return 'Letters, digits and hyphens only, starting and ending with one'
  }
  return null
}

/**
 * S3's bucket-name rule, which is stricter than a resource name here: a
 * bucket name reaches DNS through virtual-host addressing, so it can't
 * carry uppercase or underscores, and it can't look like an address.
 * Mirrored from the API rather than replacing it — the backend checks
 * too, and this is so the field can turn red before you submit.
 */
export function bucketNameError(value: string): string | null {
  const name = value.trim()
  if (!name) return null
  if (name !== name.toLowerCase()) return 'Bucket names are lowercase only'
  if (name.includes('_')) return "Underscores aren't allowed — use hyphens"
  if (name.length < 3 || name.length > 63) return 'Must be 3 to 63 characters'
  if (name.includes('..')) return "Can't contain two dots in a row"
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return "Can't look like an IP address"
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) {
    return 'Lowercase letters, digits, dots and hyphens, starting and ending with one'
  }
  return null
}
