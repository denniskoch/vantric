import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material'
import UploadIcon from '@mui/icons-material/Upload'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import RequireRole from '../components/RequireRole'
import { brandLogoURL, defaultBranding, useBranding } from '../branding'

/**
 * What this console calls itself.
 *
 * A STORED SETTING RATHER THAN A BUILD ARGUMENT, which is the whole
 * point of this page: the name and the wordmark used to be baked into
 * the bundle, so rebranding a published image meant building your own.
 */
export default function BrandingPage() {
  const brand = useBranding()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [suffix, setSuffix] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setName(brand.name)
    setSuffix(brand.suffix)
  }, [brand.name, brand.suffix])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['branding'] })

  const save = useMutation({
    mutationFn: () => api.setBranding({ name, suffix }),
    onSuccess: () => {
      refresh()
      setSaved(true)
    },
    onError: (e: Error) => setError(e.message),
  })
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadBrandLogo(file),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  })
  const removeLogo = useMutation({
    mutationFn: api.deleteBrandLogo,
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <RequireRole admin>
      <Box sx={{ p: 3, maxWidth: 720 }}>
        <PageHeader title="Branding" />

        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {saved && (
          <Alert severity="success" onClose={() => setSaved(false)} sx={{ mb: 2 }}>
            Saved.
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2.5 }}>
          {/* What it will look like, above the fields that change it —
              the masthead is the thing being edited, so showing it beats
              describing it. */}
          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>
              Masthead
            </Typography>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '4px',
              }}
            >
              {brand.hasLogo ? (
                <Box
                  component="img"
                  src={brandLogoURL(brand.version)}
                  alt={name}
                  sx={{ height: 20, display: 'block' }}
                />
              ) : (
                <Typography sx={{ fontSize: 18, fontWeight: 500 }}>{name}</Typography>
              )}
              {suffix && (
                <Typography sx={{ fontSize: 18, color: 'text.secondary' }}>{suffix}</Typography>
              )}
            </Box>
          </Box>

          <TextField
            label="Name"
            size="small"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            helperText={`Blank is ${defaultBranding.name}.`}
          />
          <TextField
            label="Suffix"
            size="small"
            fullWidth
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
            helperText="The lighter word after the name. Blank renders the name alone."
          />

          <Box>
            <Typography sx={{ fontSize: 13, mb: 1 }}>Wordmark</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box
                sx={{
                  minWidth: 120,
                  height: 44,
                  px: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {brand.hasLogo ? (
                  <Box
                    component="img"
                    src={brandLogoURL(brand.version)}
                    alt=""
                    sx={{ maxHeight: 28, maxWidth: 200 }}
                  />
                ) : (
                  <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>None</Typography>
                )}
              </Box>
              <Button
                size="small"
                startIcon={<UploadIcon />}
                disabled={upload.isPending}
                onClick={() => fileInput.current?.click()}
              >
                {brand.hasLogo ? 'Replace' : 'Upload'}
              </Button>
              {brand.hasLogo && (
                <Button
                  size="small"
                  color="error"
                  disabled={removeLogo.isPending}
                  onClick={() => removeLogo.mutate()}
                >
                  Remove
                </Button>
              )}
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                SVG, PNG, WebP or JPEG, up to 1 MB. Drawn instead of the name.
              </Typography>
            </Box>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".svg,.png,.webp,.jpg,.jpeg"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) upload.mutate(file)
                e.target.value = ''
              }}
            />
          </Box>
        </Paper>

        <Box
          sx={{ display: 'flex', gap: 1, pt: 2, mt: 2, borderTop: '1px solid', borderColor: 'divider' }}
        >
          <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </Box>
      </Box>
    </RequireRole>
  )
}
