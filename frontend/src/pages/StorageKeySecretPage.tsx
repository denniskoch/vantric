import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TextField } from '@mui/material'
import { api } from '../api/client'
import FormPage from '../components/FormPage'
import SecretField, { generateSecret } from '../components/SecretField'
import { secretKeyError } from '../validation'

/**
 * Replacing an access key's secret.
 *
 * Its own page, and not part of editing the key, because the moment it
 * saves everything still using the old secret starts failing. That is
 * the whole content of the decision, so it gets said on a page of its
 * own rather than as a third field somebody tabs past.
 *
 * A key that is DISABLED stays disabled through this — the store's
 * create call carries a status and would happily re-enable it, which
 * would turn "change the secret" into "un-revoke", so the driver reads
 * the current status and puts it back.
 */
export default function StorageKeySecretPage() {
  const { providerId = '', accessKey = '' } = useParams()
  const key = decodeURIComponent(accessKey)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [secretKey, setSecretKey] = useState(generateSecret)
  const [error, setError] = useState<string | null>(null)

  const { data: providers = [] } = useQuery({
    queryKey: ['storageProviders'],
    queryFn: api.listStorageProviders,
  })
  const storeName = providers.find((p) => p.id === providerId)?.name ?? providerId

  const save = useMutation({
    mutationFn: () => api.setStorageUserSecret(providerId, key, secretKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storageUsers'] })
      navigate('/storage/keys')
    },
    onError: (e: Error) => setError(e.message),
  })

  const secretError = secretKeyError(secretKey)

  return (
    <FormPage
      title={`Replace the secret for ${key}`}
      backTo="/storage/keys"
      backLabel="Access keys"
      error={error}
      onDismissError={() => setError(null)}
      notice="Everything signing with the old secret stops working the moment this saves. Copy the new one first — it isn't readable afterwards."
      primaryLabel="Replace"
      pendingLabel="Replacing…"
      primaryDisabled={!secretKey || Boolean(secretError)}
      pending={save.isPending}
      onPrimary={() => save.mutate()}
    >
      <TextField label="Store" size="small" value={storeName} fullWidth disabled />
      <TextField label="Access key" size="small" value={key} fullWidth disabled />
      <SecretField
        label="New secret key"
        value={secretKey}
        onChange={setSecretKey}
        error={secretError}
        helperText="Generated in your browser. Copy it now — this is the only time it's readable."
      />
    </FormPage>
  )
}
