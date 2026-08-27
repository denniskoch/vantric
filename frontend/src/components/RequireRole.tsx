import type { ReactNode } from 'react'
import { Alert, Box } from '@mui/material'
import { useLocation } from 'react-router-dom'
import { usePermissions } from '../user'
import { sectionFor } from './nav'

/**
 * A page only an owner should be looking at.
 *
 * Used for the pages that hold credentials and accounts — a viewer or
 * an editor opening one would see a form whose every button the API
 * refuses, which teaches them nothing except that the console is
 * broken. This says which role it needs instead.
 *
 * It is not the permission check. The API refuses these routes on its
 * own; this only decides what to show, and would be worth nothing if
 * the middleware trusted it.
 */
export default function RequireRole({
  admin,
  children,
}: {
  /** Owner-only. Otherwise editor-and-up. */
  admin?: boolean
  children: ReactNode
}) {
  const location = useLocation()
  const { canAdmin, canEdit, tier } = usePermissions()
  const section = sectionFor(location.pathname)
  const allowed = admin ? canAdmin : canEdit
  if (allowed) return <>{children}</>
  // NAMES THE ROLE THAT WOULD WORK. "You need a higher role" sends
  // somebody to ask an owner a question neither of them can answer;
  // "you need dns.admin" is a sentence they can paste.
  const need = `${section?.id ?? 'this section'}.${admin ? 'admin' : 'editor'}`
  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Alert severity="info">
        {admin
          ? `This page manages ${section?.label ?? 'this section'}'s stored credentials, which needs ${need}. `
          : `This page changes ${section?.label ?? 'this section'}, which needs ${need}. `}
        {tier === 'none'
          ? 'This account holds no role here.'
          : `This account has ${section?.id}.${tier}.`}{' '}
        Ask an owner to grant it.
      </Alert>
    </Box>
  )
}
