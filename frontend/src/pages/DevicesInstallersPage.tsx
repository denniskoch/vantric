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
  TextField,
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
import { usePermissions } from '../user'

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
  // Holding a file is editor work; the download token is a credential,
  // so rotating it is not. See rbac.go.
  const { canEdit, canAdmin } = usePermissions()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fraction, setFraction] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [selected, setSelected] = useState<Installer | null>(null)
  const [deleting, setDeleting] = useState<Installer | null>(null)
  // Which installer and which shell the command panel is showing. Held
  // as names rather than objects so a re-fetch doesn't strand a stale
  // one, and so an installer that no longer offers the picked shell
  // falls back rather than blanking.
  const [pickedName, setPickedName] = useState('')
  const [pickedShell, setPickedShell] = useState('')

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

  // Every command on this page embeds the download token, so all of them
  // are owner-only — the backend withholds the token from anyone else and
  // these would otherwise render a link with an empty token that fails
  // with a 404, which reads as a broken console rather than a refusal.
  const canFetchCommands = Boolean(data?.token)

  const urlFor = (name: string) =>
    `${data?.baseUrl ?? ''}/api/v1/installers/${encodeURIComponent(name)}/download?token=${data?.token ?? ''}`

  // The panel always has an answer while there is anything to install:
  // an unknown name falls through to the first installer, and a shell
  // the new installer doesn't offer falls through to its first.
  const picked = installers.find((i) => i.name === pickedName) ?? installers[0]
  const shells = picked ? commandsFor(picked, urlFor(picked.name)) : []
  const shell = shells.find((c) => c.label === pickedShell) ?? shells[0]

  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(label)
    window.setTimeout(() => setCopied(null), 1500)
  }

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Installers"
        description={
          canFetchCommands
            ? 'Agent packages a machine can fetch with one command. Download links carry a token.'
            : 'Agent packages a machine can fetch with one command. The fetch commands carry the download token, which only an owner can read.'
        }
        actions={
          <>
            {canEdit && (
              <Button
                variant="contained"
                size="small"
                startIcon={<UploadIcon />}
                disabled={fraction !== null}
                onClick={() => fileInput.current?.click()}
              >
                Upload installer
              </Button>
            )}
            {canAdmin && (
              <Button
                size="small"
                startIcon={<KeyIcon />}
                disabled={rotate.isPending}
                onClick={() => rotate.mutate()}
              >
                Rotate token
              </Button>
            )}
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
                <TableCell sx={{ color: 'text.secondary' }}>{item.platform}</TableCell>
                <TableCell align="right">{formatBytes(item.size)}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{timeAgo(item.uploadedAt)}</TableCell>
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
                <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {isLoading
                    ? 'Loading…'
                    : 'No installers yet. Upload the fleetd packages you build in Fleet, one per platform.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* THE COMMAND IS SHOWN, NOT JUST HANDED OVER. A row of copy
          buttons puts a command on your clipboard sight unseen, and the
          machine you are in the middle of setting up is the wrong place
          to be pasting something you never read. */}
      {picked && (
        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
            <TextField
              select
              size="small"
              label="Installer"
              value={picked.name}
              onChange={(e) => setPickedName(e.target.value)}
              sx={{ minWidth: 300 }}
            >
              {installers.map((item) => (
                <MenuItem key={item.name} value={item.name}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 16, display: 'flex' }}>
                      <OSIcon name={item.platform} />
                    </Box>
                    {item.platform} — {item.name}
                  </Box>
                </MenuItem>
              ))}
            </TextField>
            {/* Only where there is a choice: a Windows package has one
                shell, and a picker with one option is furniture. */}
            {shells.length > 1 && (
              <TextField
                select
                size="small"
                label="Shell"
                value={shell?.label ?? ''}
                onChange={(e) => setPickedShell(e.target.value)}
                sx={{ minWidth: 140 }}
              >
                {shells.map((c) => (
                  <MenuItem key={c.label} value={c.label}>
                    {c.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <Box sx={{ flex: 1 }} />
            <Button
              size="small"
              startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />}
              disabled={!canFetchCommands}
              onClick={() => shell && copy('command', shell.command)}
            >
              {copied === 'command' ? 'Copied' : 'Copy'}
            </Button>
          </Box>
          {canFetchCommands ? (
            <TextField
              fullWidth
              multiline
              value={shell?.command ?? ''}
              onFocus={(e) => e.target.select()}
              slotProps={{
                input: {
                  readOnly: true,
                  sx: { fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7, py: 1 },
                },
              }}
            />
          ) : (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              The command carries the download token, which only an owner can read.
            </Typography>
          )}
        </Paper>
      )}

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            if (selected) copy(`${selected.name}:url`, urlFor(selected.name))
            setMenuAnchor(null)
          }}
          disabled={!canFetchCommands}
        >
          <ContentCopyIcon fontSize="small" sx={{ mr: 1 }} /> Copy download URL
        </MenuItem>
        {/* The link CARRIES the token, so copying it is not a read —
            it hands over the credential. Deleting the file is an
            editor's, which is the smaller of the two. */}
        {canEdit && (
          <MenuItem
            onClick={() => {
              setDeleting(selected)
              setMenuAnchor(null)
            }}
            sx={{ color: 'error.main' }}
          >
            <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Delete
          </MenuItem>
        )}
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
