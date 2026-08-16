/**
 * Record sets: every record sharing a name and type, the way Cloud DNS
 * presents them. Providers return one row per value, so the grouping
 * happens here and the API saves a set as a whole.
 */
import type { DNSRecord } from './api/client'

export interface RecordSet {
  name: string
  type: string
  ttl: number
  proxied: boolean
  records: DNSRecord[]
}

/** Types whose value is a plain string, so this app can edit them.
 *  CAA, SRV and friends carry structured data and are left to the
 *  provider's own UI rather than mangled here. */
export const editableTypes = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR', 'TXT']

export const canEdit = (type: string) => editableTypes.includes(type)

/** Cloudflare proxies these types and only these. */
export const proxyableTypes = ['A', 'AAAA', 'CNAME']

/** The label a type gives its value, following Cloud DNS's wording. */
export const valueLabels: Record<string, string> = {
  A: 'IPv4 address',
  AAAA: 'IPv6 address',
  CNAME: 'Canonical name',
  MX: 'Mail server',
  NS: 'Name server',
  PTR: 'Hostname',
  TXT: 'TXT data',
}

export const valueExamples: Record<string, string> = {
  A: '192.0.2.91',
  AAAA: '2001:db8::1',
  CNAME: 'server-1.example.com',
  MX: 'mail.example.com',
  NS: 'ns1.example.com',
  PTR: 'server-1.example.com',
  TXT: 'v=spf1 include:example.com ~all',
}

/** MX and SRV carry a priority ahead of the value — including 0, which
 *  is a real setting rather than a missing one. */
export const prioritized = ['MX', 'SRV', 'URI']

export const hasPriority = (type: string) => prioritized.includes(type)

export const recordData = (record: DNSRecord) =>
  hasPriority(record.type) ? `${record.priority} ${record.content}` : record.content

export const formatTTL = (ttl: number) => (ttl <= 1 ? 'Automatic' : ttl.toLocaleString())

export function toRecordSets(records: DNSRecord[]): RecordSet[] {
  const sets = new Map<string, RecordSet>()
  for (const record of records) {
    const key = `${record.name}|${record.type}`
    const set = sets.get(key)
    if (set) {
      set.records.push(record)
    } else {
      sets.set(key, {
        name: record.name,
        type: record.type,
        ttl: record.ttl,
        proxied: record.proxied,
        records: [record],
      })
    }
  }
  return [...sets.values()]
}

/** The part of a record name that isn't the zone — what you type in
 *  the form. The apex comes back blank. */
export function relativeName(name: string, zone: string): string {
  if (name === zone) return ''
  return name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name
}
