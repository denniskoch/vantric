import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api/client'

/**
 * A terminal in the browser, proxied by the console server: the guest
 * only ever has to be reachable from the server, not from you.
 *
 * Credentials go over the socket as its first frame and are never
 * stored — not by the browser, not by the server. Closing the tab ends
 * the session.
 */
export default function InstanceSSHPage() {
  const { name = '' } = useParams()
  const navigate = useNavigate()
  const [method, setMethod] = useState<'password' | 'key'>('password')
  const [username, setUsername] = useState('root')
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const terminalRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const termRef = useRef<Terminal | null>(null)

  const { data: instance } = useQuery({
    queryKey: ['instance', name],
    queryFn: () => api.getInstance(name),
    enabled: Boolean(name),
  })

  // The terminal is created only once the session starts, so the form
  // isn't sharing the page with an empty black rectangle.
  useEffect(() => {
    if (!connected || !terminalRef.current) return
    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#202124', foreground: '#e8eaed' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(terminalRef.current)
    fit.fit()
    termRef.current = term

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(
      `${proto}//${window.location.host}/api/v1/instances/${encodeURIComponent(name)}/ssh`,
    )
    socketRef.current = socket

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          username,
          password: method === 'password' ? password : '',
          privateKey: method === 'key' ? privateKey : '',
          passphrase: method === 'key' ? passphrase : '',
          cols: term.cols,
          rows: term.rows,
        }),
      )
      term.focus()
    }
    socket.onmessage = (event) => term.write(event.data)
    socket.onerror = () => term.write('\r\n\x1b[31mConnection failed.\x1b[0m\r\n')
    socket.onclose = () => term.write('\r\n\x1b[90mSession closed.\x1b[0m\r\n')

    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'data', data }))
      }
    })

    const resize = () => {
      fit.fit()
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
      socket.close()
      term.dispose()
    }
    // Credentials are read once, when the session opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  const noAddress = instance && !instance.internalIp
  const notRunning = instance && instance.status !== 'RUNNING'
  const valid =
    username.trim() !== '' && (method === 'password' ? password !== '' : privateKey !== '')

  if (connected) {
    return (
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Button
            size="small"
            startIcon={<ArrowBackIcon />}
            onClick={() => {
              socketRef.current?.close()
              navigate('/compute/instances')
            }}
          >
            VM instances
          </Button>
          <Typography variant="h5">
            {name}
            <Box component="span" sx={{ color: '#5f6368', fontSize: 14, ml: 1 }}>
              {username}@{instance?.internalIp}
            </Box>
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={() => socketRef.current?.close()}>
            Disconnect
          </Button>
        </Box>
        <Box
          ref={terminalRef}
          sx={{
            flex: 1,
            minHeight: 0,
            bgcolor: '#202124',
            borderRadius: 1,
            p: 1,
            '& .xterm': { height: '100%' },
          }}
        />
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/compute/instances')}
        >
          VM instances
        </Button>
        <Typography variant="h5">Connect to {name}</Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2, maxWidth: 680 }}>
          {error}
        </Alert>
      )}
      {notRunning && (
        <Alert severity="warning" sx={{ mb: 2, maxWidth: 680 }}>
          This instance isn't running.
        </Alert>
      )}
      {noAddress && (
        <Alert severity="warning" sx={{ mb: 2, maxWidth: 680 }}>
          No address is known for it — the QEMU guest agent reports that, so it
          may not be installed or running.
        </Alert>
      )}
      <Alert severity="info" sx={{ mb: 2, maxWidth: 680 }}>
        The console server opens the session and relays it here, so the guest
        only has to be reachable from the server. What you type below is used
        for this session and never stored. Host keys aren't verified — lab
        guests get rebuilt too often for that to mean anything.
      </Alert>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 680 }}>
        <TextField
          label="Username"
          size="small"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          helperText={`Connects to ${instance?.internalIp ?? 'the instance'} on port 22`}
          fullWidth
        />
        <TextField
          label="Authenticate with"
          size="small"
          select
          value={method}
          onChange={(e) => setMethod(e.target.value as 'password' | 'key')}
          fullWidth
        >
          <MenuItem value="password">Password</MenuItem>
          <MenuItem value="key">Private key</MenuItem>
        </TextField>
        {method === 'password' ? (
          <TextField
            label="Password"
            size="small"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
          />
        ) : (
          <>
            <TextField
              label="Private key"
              size="small"
              multiline
              minRows={4}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              helperText="Pasted for this session only"
              fullWidth
            />
            <TextField
              label="Key passphrase (optional)"
              size="small"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              fullWidth
            />
          </>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, pt: 2, mt: 3, borderTop: '1px solid #dadce0' }}>
        <Button
          variant="contained"
          disabled={!valid || Boolean(notRunning) || Boolean(noAddress)}
          onClick={() => setConnected(true)}
        >
          Connect
        </Button>
        <Button onClick={() => navigate('/compute/instances')}>Cancel</Button>
      </Box>
    </Box>
  )
}
