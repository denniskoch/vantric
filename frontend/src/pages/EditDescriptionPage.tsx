import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'

/**
 * Editing a guest's notes.
 *
 * The description lives on the hypervisor — Proxmox shows the same
 * field in its own Notes panel — so this edits one thing in two
 * consoles rather than keeping a private copy that drifts. It gets a
 * page rather than a dialog because it's a form, and a form in a modal
 * can't be linked to, survive a reload, or grow a second field.
 *
 * The same page serves instances and templates: a template is a VM,
 * and the only difference is where the text is read from and written
 * to.
 */
interface DescriptionTarget {
  /** what the page is for, in the title */
  noun: string
  /** where Cancel and Save return to */
  backTo: (params: Record<string, string>) => string
  backLabel: string
  load: (params: Record<string, string>) => Promise<string>
  save: (params: Record<string, string>, description: string) => Promise<unknown>
  /** query keys the save invalidates */
  affects: string[]
}

export const instanceDescription: DescriptionTarget = {
  noun: 'instance',
  backTo: (p) => `/compute/instances/${p.name}`,
  backLabel: 'Instance',
  load: async (p) => (await api.getInstance(p.name)).description,
  save: (p, description) => api.setInstanceDescription(p.name, description),
  affects: ['instances', 'instance', 'instanceDetail'],
}

export const templateDescription: DescriptionTarget = {
  noun: 'template',
  backTo: () => '/compute/vm-templates',
  backLabel: 'VM templates',
  load: async (p) => (await api.describeImage(p.serverId, p.id)).description,
  save: (p, description) => api.setImageDescription(p.serverId, p.id, description),
  affects: ['images', 'image'],
}

export default function EditDescriptionPage({ target }: { target: DescriptionTarget }) {
  const params = useParams() as Record<string, string>
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [description, setDescription] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: current, isLoading } = useQuery({
    queryKey: ['description', target.noun, params],
    queryFn: () => target.load(params),
  })

  // Load once into the field, then leave what's being typed alone —
  // the instance query polls, and a poll must not overwrite an edit.
  useEffect(() => {
    if (current !== undefined) setDescription((typed) => typed ?? current)
  }, [current])

  const save = useMutation({
    mutationFn: () => target.save(params, description ?? ''),
    onSuccess: () => {
      for (const key of target.affects) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
      navigate(target.backTo(params))
    },
    onError: (e: Error) => setError(e.message),
  })

  const name = params.name ?? params.id
  const tooLong = (description?.length ?? 0) > 4096

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(target.backTo(params))}
        >
          {target.backLabel}
        </Button>
      </Box>
      <PageHeader
        title={`Edit description`}
        description={`Notes for the ${target.noun} ${name}. This is the hypervisor's own description field, so it reads the same in Proxmox.`}
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <TextField
          label="Description"
          fullWidth
          multiline
          minRows={4}
          maxRows={16}
          value={description ?? ''}
          disabled={isLoading}
          onChange={(e) => setDescription(e.target.value)}
          error={tooLong}
          helperText={
            tooLong
              ? `${description?.length} characters — 4096 is the limit`
              : 'Free text. The first line makes a good friendly name.'
          }
        />
      </Paper>

      <Box sx={{ display: 'flex', gap: 1, pt: 2, mt: 2, borderTop: '1px solid #dadce0' }}>
        <Button
          variant="contained"
          disabled={save.isPending || isLoading || tooLong || description === current}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
        <Button onClick={() => navigate(target.backTo(params))}>Cancel</Button>
        {description === current && !isLoading && (
          <Typography sx={{ alignSelf: 'center', fontSize: 12, color: 'text.secondary' }}>
            No changes yet
          </Typography>
        )}
      </Box>
    </Box>
  )
}
