import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { TextField } from '@mui/material'
import { api } from '../api/client'
import FormPage from '../components/FormPage'
import { useRefreshSession } from '../user'

/**
 * Changing your own password, which needs the current one: a borrowed
 * session shouldn't be able to lock you out of your own console.
 */
export default function MyPasswordPage() {
  const navigate = useNavigate()
  const refreshSession = useRefreshSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => api.changeOwnPassword(current, next),
    onSuccess: async () => {
      // The new password ended every session, this one included.
      await refreshSession()
      navigate('/signin', { replace: true })
    },
    onError: (e: Error) => setError(e.message),
  })

  const tooShort = next && next.length < 12 ? 'At least 12 characters' : ''
  const mismatch = confirm && confirm !== next ? "These don't match" : ''
  const same = next && next === current ? 'Pick something different from the current one' : ''

  return (
    <FormPage
      title="Change password"
      backTo="/iam/account"
      backLabel="My account"
      error={error}
      onDismissError={() => setError(null)}
      notice="You'll be signed out everywhere and asked to sign in again."
      primaryLabel="Change password"
      primaryDisabled={!current || next.length < 12 || next !== confirm || Boolean(same)}
      pending={save.isPending}
      onPrimary={() => {
        setError(null)
        save.mutate()
      }}
    >
      <TextField
        label="Current password"
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        autoComplete="current-password"
        size="small"
        fullWidth
      />
      <TextField
        label="New password"
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        error={Boolean(tooShort || same)}
        helperText={tooShort || same || 'At least 12 characters'}
        autoComplete="new-password"
        size="small"
        fullWidth
      />
      <TextField
        label="Confirm new password"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={Boolean(mismatch)}
        helperText={mismatch}
        autoComplete="new-password"
        size="small"
        fullWidth
      />
    </FormPage>
  )
}
