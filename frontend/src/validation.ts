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
    case 'NS': {
      const host = content.replace(/\.$/, '').toLowerCase()
      if (/^https?:\/\//.test(host)) return 'Enter just the hostname, without http:// or https://'
      return domainRe.test(host) ? null : 'Enter a hostname, e.g. mail.example.com'
    }
    default:
      return null
  }
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
