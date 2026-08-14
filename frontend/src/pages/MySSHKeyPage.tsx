import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TextField } from '@mui/material'
import { api } from '../api/client'
import FormPage from '../components/FormPage'

/**
 * Bringing your own SSH key, so the console signs in with the identity
 * your guests already trust instead of needing a second one deployed
 * everywhere.
 *
 * It's stored decrypted, because the console has to use it unattended
 * — the notice says so rather than letting anyone assume the
 * passphrase still protects it here.
 */
export default function MySSHKeyPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [privateKey, setPrivateKey] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => api.importMySSHKey(privateKey, passphrase),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mySSHKey'] })
      navigate('/iam/account')
    },
    onError: (e: Error) => setError(e.message),
  })

  const looksWrong =
    privateKey.trim() && !privateKey.includes('PRIVATE KEY')
      ? 'This should be a private key — the file without the .pub, beginning "-----BEGIN".'
      : ''

  return (
    <FormPage
      title="Replace SSH key"
      backTo="/iam/account"
      backLabel="My account"
      error={error}
      onDismissError={() => setError(null)}
      notice={
        <>
          The console stores this key decrypted so it can connect without
          asking you each time — a passphrase held beside the key it unlocks
          protects nothing. Anyone who can read the console's database can
          sign in as you. Prefer a key dedicated to this rather than the one
          guarding everything else you own.
        </>
      }
      primaryLabel="Replace key"
      primaryDisabled={!privateKey.trim() || Boolean(looksWrong)}
      pending={save.isPending}
      onPrimary={() => {
        setError(null)
        save.mutate()
      }}
    >
      <TextField
        label="Private key"
        value={privateKey}
        onChange={(e) => setPrivateKey(e.target.value)}
        error={Boolean(looksWrong)}
        helperText={
          looksWrong ||
          'OpenSSH format — the contents of id_ed25519, id_rsa or similar'
        }
        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
        multiline
        minRows={8}
        size="small"
        fullWidth
        slotProps={{
          input: {
            sx: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
          },
        }}
      />
      <TextField
        label="Passphrase"
        type="password"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        helperText="Only if the key is encrypted. It decrypts the key and is not stored."
        autoComplete="off"
        size="small"
        fullWidth
      />
    </FormPage>
  )
}
