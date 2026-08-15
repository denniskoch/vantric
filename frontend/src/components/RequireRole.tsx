import type { ReactNode } from 'react'
import { Alert, Box } from '@mui/material'
import { usePermissions } from '../user'

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
  const { canAdmin, canEdit, role } = usePermissions()
  const allowed = admin ? canAdmin : canEdit
  if (allowed) return <>{children}</>
  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Alert severity="info">
        {admin
          ? 'This page manages credentials and accounts, which is owner-only. '
          : 'This page changes resources, which needs the editor role. '}
        This account is {role === 'viewer' ? 'a viewer' : `an ${role}`} — ask an owner to
        change that if you need it.
      </Alert>
    </Box>
  )
}
