import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import UploadIcon from '@mui/icons-material/Upload'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import DeleteIcon from '@mui/icons-material/Delete'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import KeyIcon from '@mui/icons-material/Key'
import { api } from '../api/client'
import type { Installer } from '../api/client'
import PageHeader from '../components/PageHeader'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { OSIcon } from '../components/OSName'
import { formatBytes } from '../format'
import { timeAgo } from '../format'

/**
 * Agent installers, kept here so a machine being set up can fetch one
 * with a single command.
 *
 * The console is the source of truth for these files, which it is for
 * almost nothing else — but Fleet builds installers without hosting
 * them, and a fresh VM has no session to authenticate a download with.
 * So: upload here, and paste the command there.
 *
 * The download URL carries a token because a fleetd package contains
 * the enrollment secret. Anyone who can reach this console could
 * otherwise enrol a host of their own.
 */
export default function DevicesInstallersPage() {
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fraction, setFraction] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [selected, setSelected] = useState<Installer | null>(null)
  const [deleting, setDeleting] = useState<Installer | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['installers'],
    queryFn: api.listInstallers,
  })

  const installers = data?.installers ?? []
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['installers'] })

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadInstaller(file, setFraction),
    onSuccess: () => {
      setFraction(null)
      invalidate()
    },
    onError: (e: Error) => {
      setFraction(null)
      setError(e.message)
    },
  })

  const remove = useMutation({
    mutationFn: (name: string) => api.deleteInstaller(name),
    onSuccess: () => {
      setDeleting(null)
      invalidate()
    },
    onError: (e: Error) => {
      setDeleting(null)
      setError(e.message)
    },
  })

  const rotate = useMutation({
    mutationFn: api.rotateInstallerToken,
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  })

  const urlFor = (name: string) =>
    `${data?.baseUrl ?? ''}/api/v1/installers/${encodeURIComponent(name)}/download?token=${data?.token ?? ''}`

  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(label)
    window.setTimeout(() => setCopied(null), 1500)
  }

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Installers"
        description="Agent packages this console holds, so a machine being enrolled can fetch one with a single command. The download link carries a token — a fleetd package contains your enrollment secret, so it isn't left open."
        actions={
          <>
            <Button
              variant="contained"
              size="small"
              startIcon={<UploadIcon />}
              disabled={fraction !== null}
              onClick={() => fileInput.current?.click()}
            >
              Upload installer
            </Button>
            <Button
              size="small"
              startIcon={<KeyIcon />}
              disabled={rotate.isPending}
              onClick={() => rotate.mutate()}
            >
              Rotate token
            </Button>
          </>
        }
      />

      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".deb,.rpm,.pkg,.msi,.exe,.sh,.ps1,.gz"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload.mutate(file)
          e.target.value = ''
        }}
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* The bytes are leaving this machine, so this page waits for
          them — the same rule the ISO upload follows. */}
      {fraction !== null && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Uploading… {(fraction * 100).toFixed(0)}%
          </Typography>
          <LinearProgress variant="determinate" value={fraction * 100} />
        </Paper>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Installer</TableCell>
              <TableCell>Platform</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell>Uploaded</TableCell>
              <TableCell>Fetch it with</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {installers.map((item) => (
              <TableRow key={item.name} hover>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 16 }}>
                      <OSIcon name={item.platform} />
                    </Box>
                    {item.name}
                  </Box>
                </TableCell>
                <TableCell sx={{ color: '#5f6368' }}>{item.platform}</TableCell>
                <TableCell align="right">{formatBytes(item.size)}</TableCell>
                <TableCell sx={{ color: '#5f6368' }}>{timeAgo(item.uploadedAt)}</TableCell>
                <TableCell>
                  {/* One button per shell, because the difference
                      between them is exactly the thing you don't want
                      to be remembering on a fresh box. */}
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {commandsFor(item, urlFor(item.name)).map((cmd) => (
                      <Tooltip
                        key={cmd.label}
                        title={copied === `${item.name}:${cmd.label}` ? 'Copied' : cmd.command}
                      >
                        <Button
                          size="small"
                          startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />}
                          onClick={() => copy(`${item.name}:${cmd.label}`, cmd.command)}
                        >
                          {cmd.label}
                        </Button>
                      </Tooltip>
                    ))}
                  </Box>
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      setMenuAnchor(e.currentTarget)
                      setSelected(item)
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {installers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: '#5f6368' }}>
                  {isLoading
                    ? 'Loading…'
                    : 'No installers yet. Upload the fleetd packages you build in Fleet, one per platform.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (selected) copy(`${selected.name}:url`, urlFor(selected.name))
            setMenuAnchor(null)
          }}
        >
          <ContentCopyIcon fontSize="small" sx={{ mr: 1 }} /> Copy download URL
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDeleting(selected)
            setMenuAnchor(null)
          }}
          sx={{ color: '#d93025' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name}?`}
        body={
          <>
            The file is removed from this console. Any command still holding this
            link stops working; machines already enrolled are unaffected.
          </>
        }
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.name)}
      />
    </Box>
  )
}

/**
 * The fetch command for each shell that might be sitting in front of
 * you, ending in the install step — a downloaded package that nobody
 * installed is half an answer.
 */
function commandsFor(item: Installer, url: string): { label: string; command: string }[] {
  const quoted = `'${url}'`
  const name = item.name
  const lower = name.toLowerCase()
  if (lower.endsWith('.msi') || lower.endsWith('.exe') || lower.endsWith('.ps1')) {
    return [
      {
        label: 'PowerShell',
        command:
          `Invoke-WebRequest -Uri "${url}" -OutFile ${name}` +
          (lower.endsWith('.msi') ? `\nmsiexec /i ${name} /quiet` : ''),
      },
    ]
  }
  const install = lower.endsWith('.deb')
    ? `\nsudo dpkg -i ${name}`
    : lower.endsWith('.rpm')
      ? `\nsudo rpm -Uvh ${name}`
      : lower.endsWith('.pkg')
        ? `\nsudo installer -pkg ${name} -target /`
        : ''
  return [
    { label: 'curl', command: `curl -fsSL -o ${name} ${quoted}${install}` },
    { label: 'wget', command: `wget -O ${name} ${quoted}${install}` },
  ]
}
