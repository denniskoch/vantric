/**
 * Roles, as the console reads them.
 *
 * The backend decides; this only decides what to OFFER, which is the
 * same relationship usePermissions always had with the middleware. The
 * model is mirrored rather than fetched because the nav has to be drawn
 * before anything else loads, and a nav that shows every section and
 * then removes most of them reads as a flicker.
 *
 * A role is either a BASIC one — owner, editor, viewer, which apply to
 * every section — or "<section>.<tier>". The highest applicable tier
 * wins per section, so "viewer" plus "compute.admin" is somebody who
 * watches the lab and runs one part of it.
 */

export type Tier = 'none' | 'viewer' | 'editor' | 'admin'

const rank: Record<Tier, number> = { none: 0, viewer: 1, editor: 2, admin: 3 }

/** Ordered, so a check is a comparison rather than a set membership test. */
export function atLeast(held: Tier, need: Tier): boolean {
  return rank[held] >= rank[need]
}

const basic: Record<string, Tier> = { owner: 'admin', editor: 'editor', viewer: 'viewer' }

/**
 * What a set of role bindings grants on each section.
 *
 * A basic role raises every section at once; a section role raises one.
 * Unknown names are ignored rather than guessed at — the API refuses
 * them on the way in, so one here means a role was removed from the
 * model while a binding survived, and treating it as nothing is the
 * safe direction.
 */
export function grantsBySection(roles: string[], sectionIds: string[]): Record<string, Tier> {
  const held: Record<string, Tier> = {}
  const raise = (id: string, tier: Tier) => {
    if (rank[tier] > rank[held[id] ?? 'none']) held[id] = tier
  }
  for (const role of roles) {
    const asBasic = basic[role]
    if (asBasic) {
      for (const id of sectionIds) raise(id, asBasic)
      continue
    }
    const dot = role.indexOf('.')
    if (dot < 0) continue
    const id = role.slice(0, dot)
    const tier = role.slice(dot + 1) as Tier
    if (!sectionIds.includes(id) || !(tier in rank) || tier === 'none') continue
    raise(id, tier)
  }
  return held
}

/** "compute.admin" → "Compute Admin"; a basic role keeps its own word. */
export function roleLabel(role: string, sectionLabel?: (id: string) => string): string {
  const asBasic = basic[role]
  if (asBasic) return role.charAt(0).toUpperCase() + role.slice(1)
  const dot = role.indexOf('.')
  if (dot < 0) return role
  const id = role.slice(0, dot)
  const tier = role.slice(dot + 1)
  const label = sectionLabel?.(id) ?? id
  return `${label} ${tier.charAt(0).toUpperCase() + tier.slice(1)}`
}
