// Reverse DNS naming.
//
// A reverse zone is spelled backwards and nobody thinks in it: the
// network 192.168.80.0/24 is the zone 80.168.192.in-addr.arpa, and the
// address 192.168.80.7 is the name 7.80.168.192.in-addr.arpa. Reversing
// octets by hand is exactly the kind of clerical step that produces a
// zone which looks right and answers for nothing, so it's derived here
// and the derivation is shown before anything is created.
//
// IPv4 only. IPv6 reverse zones are nibble-reversed under ip6.arpa, and
// deriving them means fully expanding an address — worth writing when
// there's an IPv6 network in the lab to check it against. Until then a
// typed ip6.arpa name is recognised and passed through, which is honest
// where an untested conversion wouldn't be.

const IN_ADDR = 'in-addr.arpa'
const IP6 = 'ip6.arpa'

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

export interface ReverseZones {
  /** The zones this network needs, longest-prefix first. */
  zones: string[]
  /** True when there were more than `zones` lists. */
  truncated: boolean
  /** How many zones the network actually spans. */
  count: number
  error?: string
}

const failure = (error: string): ReverseZones => ({ zones: [], truncated: false, count: 0, error })

/**
 * The reverse zone(s) covering a network.
 *
 * An octet-aligned prefix is one zone. Anything longer than /24 is a
 * slice of somebody else's zone — RFC 2317 delegation, which is a
 * conversation with whoever holds the /24 rather than a zone you create
 * — and anything between the octets spans several, which is reported
 * rather than guessed at.
 */
export function reverseZonesFor(cidr: string): ReverseZones {
  const [address, length] = cidr.trim().split('/')
  const parts = octets(address ?? '')
  if (!parts) return failure('Enter a network like 192.168.80.0/24')
  const bits = Number(length)
  if (!length || !Number.isInteger(bits) || bits < 8 || bits > 32) {
    return failure('Enter a prefix length between /8 and /32')
  }
  if (bits > 24) {
    return failure(
      `A /${bits} is part of a ${parts[0]}.${parts[1]}.${parts[2]}.0/24, not a zone of its own — ` +
        'whoever holds that /24 delegates it (RFC 2317).',
    )
  }
  const label = (count: number) => parts.slice(0, count).reverse().join('.') + '.' + IN_ADDR
  if (bits % 8 === 0) {
    return { zones: [label(bits / 8)], truncated: false, count: 1 }
  }
  // Between the octets: the network spans a run of whole /24s, one per
  // value of the third octet inside the mask.
  const count = 2 ** (24 - bits)
  const first = parts[2] & (0xff << (24 - bits))
  const zones: string[] = []
  for (let i = 0; i < Math.min(count, 16); i++) {
    zones.push(`${first + i}.${parts[1]}.${parts[0]}.${IN_ADDR}`)
  }
  return { zones, truncated: count > zones.length, count }
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
