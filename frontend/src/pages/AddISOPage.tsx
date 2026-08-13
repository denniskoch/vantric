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
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { api } from '../api/client'
import { formatBytes } from '../format'

type SectionID = 'source' | 'destination' | 'verification'
type Method = 'url' | 'upload'

const filenameOk = (name: string) => /\.(iso|img)$/i.test(name.trim())

export default function AddISOPage() {
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
  const [taskId, setTaskId] = useState<string | null>(null)

  const { data: servers = [] } = useQuery({ queryKey: ['servers'], queryFn: api.listServers })
  const { data: datastores = [] } = useQuery({
    queryKey: ['datastores'],
    queryFn: api.listDatastores,
  })

  const connected = servers.filter((s) => s.status === 'connected')
  if (!serverId && connected.length > 0) setServerId(connected[0].id)

  // Only datastores on the chosen server that accept images.
  const targets = datastores.filter(
    (d) => d.serverId === serverId && d.active && d.content.includes('iso'),
  )
  const target = targets.find((d) => `${d.zone}/${d.name}` === datastore)

  const { data: task } = useQuery({
    queryKey: ['task', serverId, taskId],
    queryFn: () => api.getTask(serverId, taskId!),
    enabled: Boolean(taskId),
    refetchInterval: (query) => (query.state.data?.running === false ? false : 2000),
  })

  const start = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('choose a destination datastore')
      if (method === 'upload') {
        if (!file) throw new Error('choose a file to upload')
        const res = await api.uploadISO(
          serverId,
          { zone: target.zone, storage: target.name, filename: filename || file.name },
          file,
          setUploadFraction,
        )
        return res.taskId
      }
      const res = await api.downloadISO(serverId, {
        zone: target.zone,
        storage: target.name,
        filename,
        url,
        checksum: checksum || undefined,
        checksumAlgorithm: checksum ? checksumAlgorithm : undefined,
        verifyCertificates,
      })
      return res.taskId
    },
    onSuccess: (id) => setTaskId(id),
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
      summary: target ? `${target.name} on ${target.zone}` : 'Server and datastore',
      invalid: !destinationValid,
    },
    {
      id: 'verification',
      label: 'Verification',
      summary: checksum ? `${checksumAlgorithm} checksum` : 'Optional checksum',
    },
  ]

  // Once started, the form gives way to progress.
  if (taskId) {
    const done = task && !task.running
    const failed = done && !task.succeeded
    return (
      <Box sx={{ p: 3, maxWidth: 720 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          {method === 'upload' ? 'Uploading' : 'Downloading'} {filename}
        </Typography>
        <Paper variant="outlined" sx={{ p: 3 }}>
          {!done && (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {method === 'upload' && uploadFraction < 1
                  ? `Transferring to ${servers.find((s) => s.id === serverId)?.name}…`
                  : 'Hypervisor is finalizing the image…'}
              </Typography>
              <LinearProgress
                variant={
                  method === 'upload' && uploadFraction < 1 ? 'determinate' : 'indeterminate'
                }
                value={uploadFraction * 100}
              />
              {method === 'upload' && uploadFraction < 1 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {(uploadFraction * 100).toFixed(0)}% of {formatBytes(file?.size ?? 0)}
                </Typography>
              )}
            </>
          )}
          {done && !failed && (
            <Alert icon={<CheckCircleIcon fontSize="inherit" />} severity="success">
              {filename} is available on {target?.name}.
            </Alert>
          )}
          {failed && (
            <Alert severity="error">
              The import failed: {task?.exitStatus || 'unknown error'}
            </Alert>
          )}
          <Box sx={{ display: 'flex', gap: 1, mt: 3 }}>
            <Button
              variant="contained"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['isos'] })
                navigate('/compute/isos')
              }}
            >
              {done ? 'Done' : 'Run in background'}
            </Button>
            {failed && (
              <Button
                onClick={() => {
                  setTaskId(null)
                  setUploadFraction(0)
                }}
              >
                Try again
              </Button>
            )}
          </Box>
        </Paper>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/compute/isos')}>
          Back
        </Button>
        <Typography variant="h5">Add an ISO</Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 3, flex: 1, minHeight: 0 }}>
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
                  <ErrorIcon sx={{ fontSize: 14, color: '#d93025', mr: 1.5 }} />
                ) : (
                  <CircleIcon sx={{ fontSize: 8, color: '#5f6368', mr: 2.2, ml: 0.4 }} />
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
                    The server downloads the image directly — the file doesn't pass
                    through your browser.
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
                    placeholder="https://cdimage.debian.org/…/debian-13.0.0-amd64-netinst.iso"
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
                      accept=".iso,.img"
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
                helperText="File name on the datastore; must end in .iso or .img"
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
                    ? 'No datastore on this server accepts ISO images'
                    : 'Only datastores that accept ISO content are listed'
                }
                fullWidth
              >
                {targets.map((d) => (
                  <MenuItem key={d.id} value={`${d.zone}/${d.name}`}>
                    {d.name} — {d.zone} ({formatBytes(d.totalBytes - d.usedBytes)} free)
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
        <Button onClick={() => navigate('/compute/isos')}>Cancel</Button>
      </Box>
    </Box>
  )
}
