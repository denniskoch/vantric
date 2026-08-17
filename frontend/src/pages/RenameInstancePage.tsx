import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { instanceNameError } from '../validation'

/**
 * Renaming a VM.
 *
 * A page, not a dialog, like every other form here — and this one
 * earns it, because the rename has consequences worth reading before
 * you commit to them rather than in a box you're trying to dismiss.
 */
export default function RenameInstancePage() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: inst } = useQuery({
    queryKey: ['instance', name],
    queryFn: () => api.getInstance(name!),
    enabled: Boolean(name),
  })

  const rename = useMutation({
    mutationFn: () => api.renameInstance(name!, next.trim()),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      // Follow the guest to its new URL: the name is the key here, so
      // the old address stops resolving the moment this succeeds.
      navigate(`/compute/instances/${encodeURIComponent(updated.name)}`, {
        replace: true,
      })
    },
    onError: (e: Error) => setError(e.message),
  })

  const nameError = instanceNameError(next)
  const valid = next.trim() !== '' && !nameError && next.trim() !== name

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/compute/instances/${name}`)}
        >
          Instance
        </Button>
      </Box>
      <PageHeader title={`Rename ${name}`} />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* What a rename does and doesn't do. The second half is the
          part people assume wrongly. */}
      <Alert severity="info" sx={{ mb: 2 }}>
        This renames the virtual machine on {inst?.node ? `${inst.node}` : 'the hypervisor'} —
        the same label Proxmox shows. The guest's own hostname is not changed: nothing
        inside the machine is touched, and anything pointing at the old hostname keeps
        working. To rename the operating system, run <code>hostnamectl</code> in the guest.
      </Alert>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <TextField
          label="New name"
          size="small"
          fullWidth
          autoFocus
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={Boolean(nameError)}
          helperText={
            nameError ?? 'Letters, digits and hyphens, starting and ending with one.'
          }
        />
      </Paper>

      <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 2 }}>
        This console addresses instances by name, so its address changes with it: existing
        links to {name} will stop resolving, and an open SSH window won't reconnect.
      </Typography>

      <Box
        sx={{
          display: 'flex',
          gap: 1,
          pt: 2,
          mt: 2,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Button
          variant="contained"
          disabled={!valid || rename.isPending}
          onClick={() => rename.mutate()}
        >
          Rename
        </Button>
        <Button onClick={() => navigate(`/compute/instances/${name}`)}>Cancel</Button>
      </Box>
    </Box>
  )
}
