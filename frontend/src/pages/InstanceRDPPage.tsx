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
  // The readout that found the stacking-context bug, kept behind a
  // flag rather than deleted: it cost four wrong guesses to learn that
  // this session can't be diagnosed from either end's logs. Open the
  // window with ?debug to get it back.
  const debug = new URLSearchParams(window.location.search).has('debug')
  const [credentials, setCredentials] = useState<GuacCredentials | null>(null)

  return credentials ? (
    <Desktop name={name} credentials={credentials} debug={debug} />
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

function Desktop({
  name,
  credentials,
  debug,
}: {
  name: string
  credentials: GuacCredentials
  debug: boolean
}) {
  const holder = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  // What the session is actually doing, on screen rather than in a
  // console. A desktop that connects and draws nothing looks the same
  // as one that never connected, and the difference is not something
  // anyone should have to open devtools on a popup to find out.
  const [status, setStatus] = useState('')
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
    let received = 0
    let drawn = 0
    const report = () => {
      const element = client.getDisplay().getElement()
      const box = element.getBoundingClientRect()
      setStatus(
        `${received} instructions · ${drawn} images · display ` +
          `${Math.round(box.width)}×${Math.round(box.height)} · ${painted(element)}`,
      )
    }
    if (debug) {
      tunnel.onactivity = (opcode) => {
        received++
        // img is the opcode that carries a picture. Counting it apart
        // from the rest is what says whether the desktop is arriving
        // and failing to paint, or never arriving.
        if (opcode === 'img') drawn++
        if (received % 25 === 0) report()
      }
    }
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
    const reporting = debug ? window.setInterval(report, 1000) : 0

    const onResize = () => {
      const next = size()
      client.sendSize(next.width, next.height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.clearInterval(reporting)
      window.removeEventListener('resize', onResize)
      keyboard.reset()
      // Releasing every key on the way out: a session that ends mid
      // Ctrl-something leaves the guest believing it is still held.
      client.disconnect()
      element.remove()
      clientRef.current = null
    }
  }, [name, credentials, debug, size])

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
      {/* isolation:isolate MAKES THIS A STACKING CONTEXT, and that is
          the whole reason the desktop is visible. Guacamole's default
          layer canvas carries z-index:-1, and a negative child paints
          BEHIND the backgrounds of ordinary ancestors — so without a
          context here, the page's own dark background painted over a
          fully rendered desktop: connected, streaming, painted, and
          invisible. The context traps the canvas above this element's
          background instead of below the page's. */}
      <Box
        ref={holder}
        sx={{ display: 'flex', justifyContent: 'center', isolation: 'isolate' }}
      />
      {status && (
        <Typography
          sx={{
            position: 'absolute',
            bottom: 8,
            left: 12,
            color: '#5f6368',
            fontSize: 11,
            fontFamily: 'monospace',
            pointerEvents: 'none',
          }}
        >
          {status}
        </Typography>
      )}
    </Box>
  )
}


/**
 * Whether anything has actually been painted onto the visible canvases.
 *
 * The last question a black desktop leaves: are the pixels there and
 * something is hiding them, or were they never drawn? Everything either
 * side of this looks identical in both cases — instructions arrive, the
 * element is the right size, the logs are clean — and no amount of
 * reasoning about the protocol separates them. Reading the pixels does.
 *
 * Sampled through a tiny offscreen canvas rather than pulling a
 * megapixel of image data once a second.
 */
function painted(element: HTMLElement): string {
  const canvases = [...element.querySelectorAll('canvas')].filter(
    (c) => c.width > 1 && c.height > 1,
  )
  if (canvases.length === 0) return 'no canvas'

  const probe = document.createElement('canvas')
  probe.width = 32
  probe.height = 32
  const ctx = probe.getContext('2d', { willReadFrequently: true })
  if (!ctx) return `${canvases.length} canvases`

  for (const canvas of canvases) {
    ctx.clearRect(0, 0, 32, 32)
    try {
      ctx.drawImage(canvas, 0, 0, 32, 32)
    } catch {
      continue
    }
    const { data } = ctx.getImageData(0, 0, 32, 32)
    for (let i = 0; i < data.length; i += 4) {
      // Any pixel that is both opaque and not black counts as paint.
      if (data[i + 3] > 0 && (data[i] || data[i + 1] || data[i + 2])) {
        return `painted ${canvas.width}×${canvas.height} ${where(canvas)}`
      }
    }
  }
  return `${canvases.length} canvases, all blank`
}

/**
 * Where a canvas actually is, and whether anything is stopping it being
 * seen. Reported because a painted canvas that shows nothing has to be
 * somewhere other than where you are looking, or hidden by a property
 * that no log mentions.
 */
function where(canvas: HTMLCanvasElement): string {
  const box = canvas.getBoundingClientRect()
  const style = getComputedStyle(canvas)
  const bits = [
    `at ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}`,
  ]
  if (style.display === 'none') bits.push('display:none')
  if (style.visibility !== 'visible') bits.push(`visibility:${style.visibility}`)
  if (style.opacity !== '1') bits.push(`opacity:${style.opacity}`)
  if (style.transform !== 'none') bits.push(`transform:${style.transform}`)
  if (style.zIndex !== 'auto') bits.push(`z:${style.zIndex}`)
  return bits.join(' ')
}
