import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material'

/**
 * Confirmation for destructive actions.
 *
 * Two strengths, and the difference is whether the thing comes back.
 * A dialog you dismiss with one click is fine for a credential you can
 * re-enter or a grant you can re-issue. When the answer is "that data
 * is gone", it asks you to TYPE something first — the resource's own
 * name where it has a short one, or I UNDERSTAND where its name is a
 * 60-character archive filename nobody would retype.
 *
 * Typing is the point: it can't be muscle memory, and it makes you
 * read which row you actually clicked.
 */
export default function ConfirmDeleteDialog({
  open,
  title,
  body,
  /** Ask the user to type this exactly before the button works. */
  confirmPhrase,
  /** What the phrase is, for the prompt: "name", "I UNDERSTAND". */
  confirmLabel = 'to confirm',
  actionLabel = 'Delete',
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  body: ReactNode
  confirmPhrase?: string
  confirmLabel?: string
  actionLabel?: string
  pending?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')

  // Reset between openings, or the second delete arrives pre-confirmed
  // with the first one's answer.
  useEffect(() => {
    if (open) setTyped('')
  }, [open, confirmPhrase])

  const matches = !confirmPhrase || typed.trim() === confirmPhrase

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ fontSize: 13 }}>{body}</DialogContentText>
        {confirmPhrase && (
          <>
            <Typography sx={{ fontSize: 13, mt: 2, mb: 1, color: 'text.primary' }}>
              Type <strong>{confirmPhrase}</strong> {confirmLabel}:
            </Typography>
            <TextField
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches && !pending) onConfirm()
              }}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              size="small"
              fullWidth
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          disabled={pending || !matches}
          onClick={onConfirm}
        >
          {actionLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
