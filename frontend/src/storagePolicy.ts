/**
 * Reading an object store's policies, so the UI can say what one does
 * without printing IAM JSON at somebody.
 *
 * The store publishes its own named policies and this presents them as
 * they are — no mapping onto the three levels the database section uses,
 * because that mapping would have nowhere to put `diagnostics` or
 * `consoleAdmin` and would invent a second, wronger model of permissions
 * the store already has one of.
 */

import type { StoragePolicy } from './api/client'

const has = (actions: string[], action: string) =>
  actions.some((a) => a === action || a === '*' || a === `${action.split(':')[0]}:*`)

/**
 * THE TRAP THE STOCK POLICIES SET. The built-in `readonly` grants
 * GetObject and NOT ListBucket, so a key carrying it can fetch a key
 * whose name it already knows and cannot browse anything — which looks
 * exactly like a broken credential from the other end. The store is
 * within its rights; the console's job is to say so before somebody
 * spends an afternoon on it.
 *
 * This is derived from the policy's own actions rather than from its
 * name, so a store that ships a different readonly, or a hand-written
 * policy with the same gap, gets the same warning.
 */
export function policyWarning(policy: StoragePolicy): string | null {
  const { actions } = policy
  if (!actions.length) return 'Grants nothing.'
  if (has(actions, 's3:GetObject') && !has(actions, 's3:ListBucket')) {
    return "Can read objects but not list them — a client that browses buckets will look broken. Add s3:ListBucket in a custom policy if it needs to."
  }
  return null
}

/** A one-line read of what a policy allows, for the list and the picker. */
export function policySummary(policy: StoragePolicy): string {
  const { actions } = policy
  if (!actions.length) return 'Nothing'
  if (has(actions, 'admin:CreateUser')) return 'Full administration, including access keys'
  const write = has(actions, 's3:PutObject')
  const read = has(actions, 's3:GetObject')
  if (read && write) return 'Read and write objects'
  if (write) return 'Write objects only'
  if (read) return 'Read objects'
  if (actions.every((a) => a.startsWith('admin:') || a.startsWith('sts:'))) {
    return 'Administration, no object access'
  }
  return actions.filter((a) => a !== 'sts:AssumeRole').join(', ')
}
