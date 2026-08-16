// Reverse DNS naming.
//
// A reverse zone is spelled backwards: the network 192.168.80.0/24 is
// the zone 80.168.192.in-addr.arpa, and the address 192.168.80.7 is the
// name 7.80.168.192.in-addr.arpa.
//
// What lives here is READING that back and placing a record inside it —
// not deciding what zone a prefix deserves. Anyone creating a reverse
// zone knows which one they want; asking for a mask and computing the
// zone from it turns a one-line answer into a form that has opinions
// about RFC 2317 and classless delegation, which is a conversation with
// whoever holds the delegation rather than anything a create button
// settles.

const IN_ADDR = 'in-addr.arpa'
const IP6 = 'ip6.arpa'

/** The two reverse trees, offered as a suffix rather than derived. */
export const reverseSuffixes = [
  { value: IN_ADDR, label: `.${IN_ADDR}`, hint: 'IPv4 — the network octets, most significant last: 80.168.192' },
  { value: IP6, label: `.${IP6}`, hint: 'IPv6 — the address nibbles, most significant last' },
]

export function isReverseZone(zone: string): boolean {
  const name = zone.trim().toLowerCase().replace(/\.$/, '')
  return name.endsWith(IN_ADDR) || name.endsWith(IP6)
}

function octets(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const values = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  return values.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) ? values : null
}

/** The network a reverse zone covers, for reading a name nobody can. */
export function networkForReverseZone(zone: string): string | null {
  const name = zone.trim().toLowerCase().replace(/\.$/, '')
  if (!name.endsWith(IN_ADDR)) return null
  const labels = name.slice(0, -(IN_ADDR.length + 1)).split('.').filter(Boolean)
  if (labels.length === 0 || labels.length > 4) return null
  if (!labels.every((l) => /^\d{1,3}$/.test(l) && Number(l) <= 255)) return null
  const forward = [...labels].reverse().map(Number)
  const padded = [...forward, 0, 0, 0].slice(0, 4)
  return `${padded.join('.')}/${forward.length * 8}`
}

/** The full PTR name for an address, e.g. 7.80.168.192.in-addr.arpa. */
export function ptrNameFor(address: string): string | null {
  const parts = octets(address.trim())
  return parts ? `${[...parts].reverse().join('.')}.${IN_ADDR}` : null
}

/**
 * What to put in the record form's name field for an address, given the
 * zone it's going into — the leading labels, with the zone's own
 * suffix removed. Null when the address isn't inside the zone, which is
 * the mistake worth catching: 192.168.80.7 typed into a zone for
 * 192.168.20.0/24 would otherwise become a name in the wrong network.
 */
export function relativePtrName(address: string, zone: string): string | null {
  const full = ptrNameFor(address)
  if (!full) return null
  const suffix = zone.trim().toLowerCase().replace(/\.$/, '')
  if (full === suffix) return '@'
  return full.endsWith('.' + suffix) ? full.slice(0, -(suffix.length + 1)) : null
}

/** Whether a value looks like the user meant an address, not a label. */
export function looksLikeIPv4(value: string): boolean {
  return octets(value.trim()) !== null
}
