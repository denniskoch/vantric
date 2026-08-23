import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import UploadIcon from '@mui/icons-material/Upload'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { shortcutLinkError } from '../validation'

/**
 * Adding a tile, or correcting one. A page rather than a dialog, like
 * every other form here.
 *
 * THE ICON IS STAGED, NOT UPLOADED, while the shortcut is new: there is
 * no id to attach it to until the record exists, so the file waits in
 * the browser and goes up as the second half of Create. That way one
 * button does what it says — a form that made you save, come back and
 * then add the picture would be two steps for one intention.
 */
export default function ShortcutFormPage() {
  const { id } = useParams<{ id: string }>()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [url, setURL] = useState('')
  const [staged, setStaged] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: existing } = useQuery({
    queryKey: ['shortcuts'],
    queryFn: api.listShortcuts,
    enabled: editing,
    select: (all) => all.find((s) => s.id === id),
  })

  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setURL(existing.url)
  }, [existing])

  // An object URL is a live handle on the file; leaking one per pick
  // would keep every image the form has seen alive until reload.
  useEffect(() => {
    if (!staged) return
    const objectURL = URL.createObjectURL(staged)
    setPreview(objectURL)
    return () => URL.revokeObjectURL(objectURL)
  }, [staged])

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['shortcuts'] })
    navigate('/shortcuts')
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = { name, url }
      const saved = editing ? await api.updateShortcut(id!, body) : await api.createShortcut(body)
      if (staged) await api.uploadShortcutIcon(saved.id, staged)
    },
    onSuccess: done,
    onError: (e: Error) => setError(e.message),
  })

  const removeIcon = useMutation({
    mutationFn: () => api.deleteShortcutIcon(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shortcuts'] }),
    onError: (e: Error) => setError(e.message),
  })

  const linkError = shortcutLinkError(url)
  const complete = name.trim() !== '' && url.trim() !== ''
  const valid = complete && !linkError

  const currentIcon =
    preview ??
    (existing?.icon
      ? `/api/v1/shortcuts/${existing.id}/icon?v=${encodeURIComponent(existing.updatedAt)}`
      : null)

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/shortcuts')}>
          Shortcuts
        </Button>
      </Box>
      <PageHeader title={editing ? 'Edit shortcut' : 'Add shortcut'} />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2.5 }}>
        <TextField
          label="Name"
          size="small"
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="Link"
          size="small"
          fullWidth
          value={url}
          onChange={(e) => setURL(e.target.value)}
          error={Boolean(linkError)}
          helperText={linkError ?? 'A bare host becomes https://.'}
        />
        <Box>
          <Typography sx={{ fontSize: 13, mb: 1 }}>Icon</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              {currentIcon ? (
                <Box
                  component="img"
                  src={currentIcon}
                  alt=""
                  sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>None</Typography>
              )}
            </Box>
            <Button
              size="small"
              startIcon={<UploadIcon />}
              onClick={() => fileInput.current?.click()}
            >
              {currentIcon ? 'Replace' : 'Upload'}
            </Button>
            {/* Clearing a staged file needs no round trip; clearing a
                stored one does, and only exists once there is one. */}
            {staged ? (
              <Button size="small" onClick={() => setStaged(null)}>
                Clear
              </Button>
            ) : (
              existing?.icon && (
                <Button
                  size="small"
                  color="error"
                  disabled={removeIcon.isPending}
                  onClick={() => removeIcon.mutate()}
                >
                  Remove
                </Button>
              )
            )}
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              PNG, JPEG, GIF, WebP, SVG or ICO, up to 1 MB.
            </Typography>
          </Box>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.ico"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) setStaged(file)
              e.target.value = ''
            }}
          />
        </Box>
      </Paper>

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
        <Button variant="contained" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {editing ? 'Save' : 'Create'}
        </Button>
        <Button onClick={() => navigate('/shortcuts')}>Cancel</Button>
        {!complete && (
          <Typography sx={{ alignSelf: 'center', fontSize: 12, color: 'text.secondary' }}>
            A name and a link are required
          </Typography>
        )}
      </Box>
    </Box>
  )
}
