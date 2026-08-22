import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Box, Button, TextField, Typography } from '@mui/material'
import Guacamole from 'guacamole-common-js'
import { FirstFrameTunnel } from '../guacTunnel'
import type { GuacCredentials } from '../guacTunnel'

/**
 * A Windows desktop, in its own window.
 *
 * Same shape as the SSH terminal next door: this page opens detached,
 * because a desktop outlives the list you launched it from and you want
 * the console beside it rather than behind it.
 *
 * CREDENTIALS ARE ASKED FOR HERE AND NOWHERE ELSE. They go down the
 * socket as its first frame and are not kept — not in storage, not in
 * the URL, not on the way back. Leaving them blank is a real choice and
 * is explained at the prompt: whether it works is a property of the
 * guest, not of this console.
 */
export default function InstanceRDPPage() {
  const { name = '' } = useParams()
  const [credentials, setCredentials] = useState<GuacCredentials | null>(null)

  return credentials ? (
    <Desktop name={name} credentials={credentials} />
  ) : (
    <Prompt name={name} onConnect={setCredentials} />
  )
}

function Prompt({
  name,
  onConnect,
}: {
  name: string
  onConnect: (credentials: GuacCredentials) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [domain, setDomain] = useState('')

  return (
    <Box sx={{ p: 4, maxWidth: 460 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        Connect to {name}
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        Used once to open this session and not stored.
      </Typography>

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault()
          onConnect({ username, password, domain })
        }}
        sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
      >
        <TextField
          label="Username"
          size="small"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          fullWidth
        />
        <TextField
          label="Password"
          type="password"
          size="small"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
        />
        <TextField
          label="Domain"
          size="small"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          helperText="Optional"
          fullWidth
        />
        {/* Whether blank works is the guest's decision, and it is worth
            saying which way round it is — otherwise an empty form looks
            like a bug when the connection is refused. */}
        <Alert severity="info">
          Leave these blank to reach the guest's own logon screen. That needs Network
          Level Authentication turned off on the guest; with NLA on, Windows
          authenticates before the session exists and the connection is refused
          without credentials.
        </Alert>
        <Box>
          <Button type="submit" variant="contained" size="small">
            Connect
          </Button>
        </Box>
      </Box>
    </Box>
  )
}

function Desktop({ name, credentials }: { name: string; credentials: GuacCredentials }) {
  const holder = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const clientRef = useRef<Guacamole.Client | null>(null)

  // The window the session is opening into. RDP fixes a resolution when
  // it starts, so the first request has to be honest about the space —
  // resizing afterwards is a separate instruction.
  const size = useCallback(
    () => ({
      width: Math.max(640, Math.floor(window.innerWidth)),
      height: Math.max(480, Math.floor(window.innerHeight)),
      dpi: Math.round(96 * (window.devicePixelRatio || 1)),
    }),
    [],
  )

  useEffect(() => {
    const { width, height, dpi } = size()
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url =
      `${scheme}://${window.location.host}/api/v1/instances/${encodeURIComponent(name)}/rdp` +
      `?width=${width}&height=${height}&dpi=${dpi}`

    const tunnel = new FirstFrameTunnel(url, credentials)
    const client = new Guacamole.Client(tunnel)
    clientRef.current = client

    client.onerror = (status) => setError(status.message || 'The connection ended.')
    tunnel.onerror = (status) => setError(status.message || 'The connection ended.')

    const display = client.getDisplay()
    const element = display.getElement()
    holder.current?.appendChild(element)

    const mouse = new Guacamole.Mouse(element)
    const send = (state: Parameters<NonNullable<typeof mouse.onmousedown>>[0]) =>
      client.sendMouseState(state)
    mouse.onmousedown = send
    mouse.onmouseup = send
    mouse.onmousemove = send

    // The keyboard listens on the DOCUMENT, not the canvas: a canvas
    // takes no focus of its own, so keys typed anywhere in this window
    // are meant for the desktop — there is nothing else here to type
    // into.
    const keyboard = new Guacamole.Keyboard(document)
    keyboard.onkeydown = (keysym) => client.sendKeyEvent(1, keysym)
    keyboard.onkeyup = (keysym) => client.sendKeyEvent(0, keysym)

    client.connect()
    setConnected(true)

    const onResize = () => {
      const next = size()
      client.sendSize(next.width, next.height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      keyboard.reset()
      // Releasing every key on the way out: a session that ends mid
      // Ctrl-something leaves the guest believing it is still held.
      client.disconnect()
      element.remove()
      clientRef.current = null
    }
  }, [name, credentials, size])

  return (
    <Box sx={{ height: '100vh', bgcolor: '#202124', position: 'relative', overflow: 'hidden' }}>
      {error && (
        <Alert severity="error" sx={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 2 }}>
          {error}
        </Alert>
      )}
      {!connected && !error && (
        <Typography sx={{ position: 'absolute', top: 16, left: 16, color: '#9aa0a6', fontSize: 13 }}>
          Connecting to {name}…
        </Typography>
      )}
      <Box ref={holder} sx={{ display: 'flex', justifyContent: 'center' }} />
    </Box>
  )
}
