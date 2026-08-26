import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, onUnauthorized, UnauthorizedError } from './api/client'
import type { IAMUser } from './api/client'

/**
 * Who the console thinks you are — now an actual answer from the
 * server rather than a constant. The session is an HttpOnly cookie, so
 * this is the only way to find out.
 */
/** Guards the re-check below; module-level so every hook shares it. */
let recheckScheduled = false

export function useSession() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['session'],
    queryFn: api.me,
    // A 401 here is the answer ("nobody"), not a failure to retry.
    retry: (_count, err) => !(err instanceof UnauthorizedError),
    staleTime: 60_000,
  })

  // A 401 ON ANY REQUEST ENDS THE SESSION, not just a 401 on this one.
  // This query is cached for a minute and never polled, so an expired
  // session used to show up as red alerts on whatever page you were
  // looking at while the shell still believed you were signed in — and
  // only a reload, which re-runs this, actually sent you to sign in.
  //
  // It re-asks rather than assuming: the server is the one that knows,
  // and a single 401 from a backend having a bad moment should not sign
  // you out of the console.
  //
  // ONE RE-ASK PER BURST. This hook is called from several components
  // and a page fires several queries at once, so the naive version made
  // one /auth/me per listener per 401 — four for a single expiry here,
  // and many more on a page mid-load. The flag collapses them: whoever
  // notices first schedules the check, everyone else rides along.
  useEffect(
    () =>
      onUnauthorized(() => {
        if (recheckScheduled) return
        recheckScheduled = true
        queueMicrotask(() => {
          recheckScheduled = false
          queryClient.invalidateQueries({ queryKey: ['session'] })
        })
      }),
    [queryClient],
  )
  return {
    user: data ?? null,
    loading: isLoading,
    signedOut: error instanceof UnauthorizedError,
  }
}

/**
 * What this account may do, mirroring the roles the API enforces.
 *
 * The API is the boundary — these only decide what to OFFER. A button
 * that exists and then fails is a worse answer than a button that
 * isn't there, but a hidden button is not a permission check, which is
 * why the middleware doesn't trust any of this.
 */
export function usePermissions() {
  const { user } = useSession()
  const role = user?.role ?? 'viewer'
  return {
    role,
    /** Resources: instances, records, databases, templates. */
    canEdit: role === 'owner' || role === 'editor',
    /** Credentials, accounts and sign-on settings. */
    canAdmin: role === 'owner',
  }
}

/** Drops the cached session so the app re-asks after signing in or out. */
export function useRefreshSession() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['session'] })
}

/**
 * The account SSH connects as: the local part of your identity, the
 * way a cloud console derives a guest login from an email.
 *
 * Never root. A console that logs into every guest as root turns one
 * stolen session into the whole lab, and sudo asks the question that
 * makes you think.
 */
export function sshUsername(user: IAMUser | null): string {
  return user?.email.split('@')[0] || 'lab'
}

/** First letter of the name, or the email, for the avatar. */
export function initialFor(user: IAMUser | null): string {
  const source = user?.name || user?.email || '?'
  return source.charAt(0).toUpperCase()
}
