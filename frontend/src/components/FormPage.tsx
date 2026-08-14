import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'

/**
 * The shell every form in this app wears: back link, title, the fields,
 * and a persistent Save/Cancel bar — GCP's create-flow layout.
 *
 * Modals are for confirmation only, so anything you fill in is a page,
 * and a page needs this frame. Having it in one place is what keeps
 * seven forms from drifting into seven layouts.
 */
export default function FormPage({
  title,
  backTo,
  backLabel,
  children,
  error,
  onDismissError,
  notice,
  primaryLabel,
  pendingLabel,
  primaryDisabled,
  pending,
  onPrimary,
  width = 680,
}: {
  title: string
  backTo: string
  backLabel: string
  children: ReactNode
  error?: string | null
  onDismissError?: () => void
  /** Standing explanation shown above the fields. */
  notice?: ReactNode
  primaryLabel: string
  pendingLabel?: string
  primaryDisabled?: boolean
  pending?: boolean
  onPrimary: () => void
  width?: number
}) {
  const navigate = useNavigate()
  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate(backTo)}>
          {backLabel}
        </Button>
        <Typography variant="h5">{title}</Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={onDismissError} sx={{ mb: 2, maxWidth: width }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="info" sx={{ mb: 2, maxWidth: width }}>
          {notice}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: width }}>
        {children}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, pt: 2, mt: 3, borderTop: '1px solid #dadce0' }}>
        <Button variant="contained" disabled={primaryDisabled || pending} onClick={onPrimary}>
          {pending ? (pendingLabel ?? 'Saving…') : primaryLabel}
        </Button>
        <Button onClick={() => navigate(backTo)}>Cancel</Button>
      </Box>
    </Box>
  )
}
