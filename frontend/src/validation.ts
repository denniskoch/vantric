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

/** Filenames for datastore uploads/downloads. */
export function filenameError(value: string, extensions: RegExp, hint: string): string | null {
  const name = value.trim()
  if (!name) return null
  if (name.includes('/')) return 'Just the file name, without any path'
  if (!extensions.test(name)) return `Must end in ${hint}`
  return null
}
