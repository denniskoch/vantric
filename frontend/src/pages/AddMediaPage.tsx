import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CircleIcon from '@mui/icons-material/Circle'
import ErrorIcon from '@mui/icons-material/Error'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { formatBytes } from '../format'
import { filenameError, urlError } from '../validation'

type SectionID = 'source' | 'destination' | 'verification'
type Method = 'url' | 'upload'

/**
 * ISOs and cloud images are the same flow over different datastore
 * content types, so the page is parameterized rather than duplicated.
 */
export interface MediaKind {
  title: string
  /** datastore content type the destination must accept */
  content: string
  extensions: RegExp
  extensionHint: string
  /** value for the file picker's accept attribute */
  accept: string
  listPath: string
  urlPlaceholder: string
  urlBlurb: string
  download: typeof api.downloadISO
  upload: typeof api.uploadISO
}

export const isoKind: MediaKind = {
  title: 'Add an ISO',
  content: 'iso',
  extensions: /\.(iso|img)$/i,
  extensionHint: '.iso or .img',
  accept: '.iso,.img',
  listPath: '/compute/isos',
  urlPlaceholder: 'https://cdimage.debian.org/…/debian-13.0.0-amd64-netinst.iso',
  urlBlurb: "The server downloads the image directly — the file doesn't pass through your browser.",
  download: api.downloadISO,
  upload: api.uploadISO,
}

export const cloudImageKind: MediaKind = {
  title: 'Add a cloud image',
  content: 'import',
  extensions: /\.(qcow2|raw|img|vmdk)$/i,
  extensionHint: '.qcow2, .raw, .img or .vmdk',
  accept: '.qcow2,.raw,.img,.vmdk',
  listPath: '/compute/cloud-images',
  urlPlaceholder: 'https://cloud.debian.org/…/debian-13-genericcloud-amd64.qcow2',
  urlBlurb:
    'Cloud images come from your distro’s cloud-image site — Debian genericcloud, Ubuntu cloudimg, Fedora Cloud. The server downloads it directly.',
  download: api.downloadCloudImage,
  upload: api.uploadCloudImage,
}

export default function AddMediaPage({ kind }: { kind: MediaKind }) {
  const filenameOk = (name: string) => kind.extensions.test(name.trim())
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)

  const [section, setSection] = useState<SectionID>('source')
  const [method, setMethod] = useState<Method>('url')
  const [url, setUrl] = useState('')
  const [filename, setFilename] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [serverId, setServerId] = useState('')
  const [datastore, setDatastore] = useState('')
  const [checksum, setChecksum] = useState('')
  const [checksumAlgorithm, setChecksumAlgorithm] = useState('sha256')
  const [verifyCertificates, setVerifyCertificates] = useState(true)

  const [error, setError] = useState<string | null>(null)
  const [uploadFraction, setUploadFraction] = useState(0)

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  const { data: datastores = [] } = useQuery({
    queryKey: ['datastores'],
    queryFn: api.listDatastores,
  })

  const connected = servers.filter((s) => s.status === 'connected')
  if (!serverId && connected.length > 0) setServerId(connected[0].id)

  // Only datastores on the chosen server that accept images.
  const targets = datastores.filter(
    (d) => d.serverId === serverId && d.active && d.content.includes(kind.content),
  )
  const target = targets.find((d) => `${d.node}/${d.name}` === datastore)

  const start = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('choose a destination datastore')
      if (method === 'upload') {
        if (!file) throw new Error('choose a file to upload')
        await kind.upload(
          serverId,
          { node: target.node, storage: target.name, filename: filename || file.name },
          file,
          setUploadFraction,
        )
        return
      }
      await kind.download(serverId, {
        node: target.node,
        storage: target.name,
        filename,
        url,
        checksum: checksum || undefined,
        checksumAlgorithm: checksum ? checksumAlgorithm : undefined,
        verifyCertificates,
      })
    },
    // Whatever happens next happens on the hypervisor, and it reports to
    // the notification bell. The page's job ended when the bytes did.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations'] })
      navigate(kind.listPath)
    },
    onError: (e: Error) => setError(e.message),
  })

  const chooseFile = (f: File | null) => {
    setFile(f)
    if (f && !filename) setFilename(f.name)
  }

  const sourceValid =
    method === 'url'
      ? /^https?:\/\/\S+$/.test(url) && filenameOk(filename)
      : Boolean(file) && filenameOk(filename || file?.name || '')
  const destinationValid = Boolean(target)
  const valid = sourceValid && destinationValid

  const sections: { id: SectionID; label: string; summary: string; invalid?: boolean }[] = [
    {
      id: 'source',
      label: 'Source',
      summary: sourceValid
        ? method === 'url'
          ? filename
          : `${file?.name} (${formatBytes(file?.size ?? 0)})`
        : method === 'url'
          ? 'Download from a URL'
          : 'Upload from this computer',
      invalid: !sourceValid,
    },
    {
      id: 'destination',
      label: 'Destination',
      summary: target ? `${target.name} on ${target.node}` : 'Server and datastore',
      invalid: !destinationValid,
    },
    {
      id: 'verification',
      label: 'Verification',
      summary: checksum ? `${checksumAlgorithm} checksum` : 'Optional checksum',
    },
  ]

  // An upload is the one thing here the browser does itself, so it's
  // the one thing this page waits for. Everything after the last byte —
  // the hypervisor's own import — belongs to the notification bell.
  if (start.isPending && method === 'upload') {
    return (
      <Box sx={{ p: 3, maxWidth: 720 }}>
        <PageHeader title={`Uploading ${filename || file?.name}`} />
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Transferring to {servers.find((s) => s.id === serverId)?.name}…
          </Typography>
          <LinearProgress variant="determinate" value={uploadFraction * 100} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {(uploadFraction * 100).toFixed(0)}% of {formatBytes(file?.size ?? 0)}
          </Typography>
        </Paper>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate(kind.listPath)}>
          Back
        </Button>
        <Typography variant="h5">{kind.title}</Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 3 }}>
        <Paper variant="outlined" sx={{ width: 260, flexShrink: 0, alignSelf: 'flex-start' }}>
          <List dense disablePadding>
            {sections.map((sec) => (
              <ListItemButton
                key={sec.id}
                selected={section === sec.id}
                onClick={() => setSection(sec.id)}
                sx={{
                  py: 1.2,
                  borderLeft: section === sec.id ? '3px solid #1a73e8' : '3px solid transparent',
                }}
              >
                {sec.invalid ? (
                  <ErrorIcon sx={{ fontSize: 14, color: 'error.main', mr: 1.5 }} />
                ) : (
                  <CircleIcon sx={{ fontSize: 8, color: 'text.secondary', mr: 2.2, ml: 0.4 }} />
                )}
                <ListItemText
                  primary={sec.label}
                  secondary={sec.summary}
                  slotProps={{
                    primary: { sx: { fontWeight: section === sec.id ? 500 : 400 } },
                    secondary: { sx: { fontSize: 11, wordBreak: 'break-all' } },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>

        <Paper
          variant="outlined"
          sx={{ flex: 1, maxWidth: 640, p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, alignSelf: 'flex-start' }}
        >
          {section === 'source' && (
            <>
              <Typography variant="h6">Source</Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={method}
                onChange={(_, v: Method | null) => v && setMethod(v)}
              >
                <ToggleButton value="url" sx={{ textTransform: 'none', px: 2 }}>
                  Download from URL
                </ToggleButton>
                <ToggleButton value="upload" sx={{ textTransform: 'none', px: 2 }}>
                  Upload a file
                </ToggleButton>
              </ToggleButtonGroup>

              {method === 'url' ? (
                <>
                  <Typography variant="body2" color="text.secondary">
                    {kind.urlBlurb}
                  </Typography>
                  <TextField
                    label="Image URL"
                    size="small"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value)
                      const guessed = e.target.value.split('/').pop() ?? ''
                      if (filenameOk(guessed)) setFilename(guessed)
                    }}
                    placeholder={kind.urlPlaceholder}
                    error={Boolean(urlError(url))}
                    helperText={urlError(url) ?? ' '}
                    fullWidth
                  />
                </>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary">
                    The file is streamed through this console to the server.
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Button
                      variant="outlined"
                      startIcon={<UploadFileIcon />}
                      onClick={() => fileInput.current?.click()}
                      sx={{ flexShrink: 0 }}
                    >
                      Choose file
                    </Button>
                    <Typography variant="body2" sx={{ color: file ? '#202124' : '#5f6368' }}>
                      {file ? `${file.name} — ${formatBytes(file.size)}` : 'No file selected'}
                    </Typography>
                    <input
                      ref={fileInput}
                      type="file"
                      accept={kind.accept}
                      hidden
                      onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
                    />
                  </Box>
                </>
              )}

              <TextField
                label="Save as"
                size="small"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                error={Boolean(filenameError(filename, kind.extensions, kind.extensionHint))}
                helperText={
                  filenameError(filename, kind.extensions, kind.extensionHint) ??
                  `File name on the datastore; must end in ${kind.extensionHint}`
                }
                fullWidth
              />
            </>
          )}

          {section === 'destination' && (
            <>
              <Typography variant="h6">Destination</Typography>
              <TextField
                label="Server"
                size="small"
                select
                value={serverId}
                onChange={(e) => {
                  setServerId(e.target.value)
                  setDatastore('')
                }}
                fullWidth
              >
                {servers.map((s) => (
                  <MenuItem key={s.id} value={s.id} disabled={s.status !== 'connected'}>
                    {s.name} ({s.status})
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Datastore"
                size="small"
                select
                value={datastore}
                onChange={(e) => setDatastore(e.target.value)}
                helperText={
                  targets.length === 0
                    ? `No datastore on this server accepts ${kind.content} content`
                    : `Only datastores that accept ${kind.content} content are listed`
                }
                fullWidth
              >
                {targets.map((d) => (
                  <MenuItem key={d.id} value={`${d.node}/${d.name}`}>
                    {d.name} — {d.node} ({formatBytes(d.totalBytes - d.usedBytes)} free)
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}

          {section === 'verification' && (
            <>
              <Typography variant="h6">Verification</Typography>
              {method === 'upload' ? (
                <Typography variant="body2" color="text.secondary">
                  Checksum verification applies to URL downloads only.
                </Typography>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary">
                    Optional. The server rejects the download if the checksum doesn't
                    match.
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                      label="Checksum"
                      size="small"
                      value={checksum}
                      onChange={(e) => setChecksum(e.target.value.trim())}
                      sx={{ flex: 1 }}
                    />
                    <TextField
                      label="Algorithm"
                      size="small"
                      select
                      value={checksumAlgorithm}
                      onChange={(e) => setChecksumAlgorithm(e.target.value)}
                      sx={{ width: 140 }}
                    >
                      {['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512'].map((a) => (
                        <MenuItem key={a} value={a}>
                          {a}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={verifyCertificates}
                        onChange={(e) => setVerifyCertificates(e.target.checked)}
                      />
                    }
                    label="Verify the source's TLS certificate"
                  />
                </>
              )}
            </>
          )}
        </Paper>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, pt: 2, mt: 2, borderTop: '1px solid #dadce0' }}>
        <Button
          variant="contained"
          disabled={!valid || start.isPending}
          onClick={() => start.mutate()}
        >
          {method === 'upload' ? 'Upload' : 'Download'}
        </Button>
        <Button onClick={() => navigate(kind.listPath)}>Cancel</Button>
      </Box>
    </Box>
  )
}
