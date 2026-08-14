import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { TextField } from '@mui/material'
import { api } from '../api/client'
import FormPage from '../components/FormPage'

/**
 * An administrator resetting someone else's password.
 *
 * No current password is asked for — the point of a reset is that it's
 * been lost. Their sessions end with it, so a reset is also how you
 * evict someone in a hurry.
 */
export default function IAMPasswordPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: user } = useQuery({
    queryKey: ['iamUser', id],
    queryFn: () => api.getIAMUser(id),
    enabled: Boolean(id),
  })

  const save = useMutation({
    mutationFn: () => api.setIAMUserPassword(id, password),
    onSuccess: () => navigate('/iam/users'),
    onError: (e: Error) => setError(e.message),
  })

  const tooShort = password && password.length < 12 ? 'At least 12 characters' : ''
  const mismatch = confirm && confirm !== password ? "These don't match" : ''

  return (
    <FormPage
      title={user ? `Reset password for ${user.email}` : 'Reset password'}
      backTo="/iam/users"
      backLabel="Users"
      error={error}
      onDismissError={() => setError(null)}
      notice="Every session this account holds ends as soon as the password changes."
      primaryLabel="Set password"
      primaryDisabled={password.length < 12 || password !== confirm}
      pending={save.isPending}
      onPrimary={() => {
        setError(null)
        save.mutate()
      }}
    >
      <TextField
        label="New password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={Boolean(tooShort)}
        helperText={tooShort || 'At least 12 characters'}
        autoComplete="new-password"
        size="small"
        fullWidth
      />
      <TextField
        label="Confirm password"
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
