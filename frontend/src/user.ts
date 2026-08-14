/**
 * Who the console thinks you are. A stub until sign-in exists —
 * replacing this constant with what OIDC returns is meant to be the
 * whole change.
 */
export const currentUser = {
  name: 'Lab administrator',
  email: 'lab@localhost',
  initial: 'L',
}

/**
 * The account SSH connects as: the local part of your identity, the
 *  way a cloud console derives a guest login from an email.
 *
 * Never root. A console that logs into every guest as root turns one
 * stolen session into the whole lab, and sudo asks the question that
 * makes you think.
 */
export function sshUsername(): string {
  return currentUser.email.split('@')[0] || 'lab'
}
