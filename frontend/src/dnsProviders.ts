// What differs between DNS provider types, in one place.
//
// Keyed on the type string the backend already returns, so adding a
// provider needs no API change — the same rule brands.ts follows.
import type { DNSProviderType } from './api/client'

interface ProviderTraits {
  label: string
  /**
   * Whether the provider distinguishes a full zone from a partial
   * (CNAME-setup) one. That is a hosted-DNS product decision about who
   * answers for a domain, not a property of DNS, so an authoritative
   * server you run has no such setting — and offering one there would
   * be a control that changes nothing.
   */
  zoneModes: boolean
}

const traits: Record<string, ProviderTraits> = {
  cloudflare: { label: 'Cloudflare', zoneModes: true },
  powerdns: { label: 'PowerDNS', zoneModes: false },
}

export const providerLabel = (type: DNSProviderType | string) => traits[type]?.label ?? type

export const usesZoneModes = (type: DNSProviderType | string | undefined) =>
  type ? (traits[type]?.zoneModes ?? false) : false
