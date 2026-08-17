// Reverse DNS naming.
//
// A reverse zone is spelled backwards: the network 192.168.80.0/24 is
// the zone 80.168.192.in-addr.arpa, and the address 192.168.80.7 is the
// name 7.80.168.192.in-addr.arpa.
//
// What lives here is READING that back — telling a reverse zone from a
// forward one, and saying which network one covers. Nothing here works
// anything out on the operator's behalf. Deriving a zone from a prefix,
// or a record's name from an address, is arithmetic that anyone
// creating reverse DNS already does in their head, and a console that
// does it for them is a console that has to be right about RFC 2317
// and about which network an address belongs to. It states what it
// reads and gets out of the way.

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
