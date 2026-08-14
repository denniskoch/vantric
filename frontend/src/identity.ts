/** Shared bits of the Identity Platform section. */
export const providerLabels: Record<string, string> = {
  authentik: 'authentik',
}

/** authentik separates people from the accounts its own internals use. */
export const userKinds: Record<string, string> = {
  internal: 'Person',
  external: 'External',
  service_account: 'Service account',
  internal_service_account: 'Service account',
}

export const userKind = (kind: string) => userKinds[kind] ?? kind ?? '—'

/** An account authentik created for itself (outposts, tokens) rather
 *  than one you made for a person. */
export const isServiceAccount = (kind: string) => kind.includes('service_account')
