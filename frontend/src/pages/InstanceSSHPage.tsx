import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Box, Button, Typography } from '@mui/material'
import TerminalIcon from '@mui/icons-material/Terminal'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api/client'
import { sshUsername } from '../user'

/**
 * A terminal in the browser, proxied by the console server: the guest
 * only has to be reachable from the server, not from you.
 *
 * Nothing is asked before connecting. The console authenticates with
 * its own key and signs in as your identity's local part, the way a
 * cloud console derives a guest login from an email — so the page you
 * land on is a shell, not a form.
 */
export default function InstanceSSHPage() {
  const { name = '' } = useParams()
  const username = sshUsername()

  const terminalRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)

  const { data: instance } = useQuery({
    queryKey: ['instance', name],
    queryFn: () => api.getInstance(name),
    enabled: Boolean(name),
  })

  useEffect(() => {
    if (!terminalRef.current) return
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

    document.title = `${name} — ssh`
    term.writeln(`\x1b[90mConnecting as ${username}…\x1b[0m`)

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(
      `${proto}//${window.location.host}/api/v1/instances/${encodeURIComponent(name)}/ssh`,
    )
    socketRef.current = socket

    socket.onopen = () => {
      socket.send(JSON.stringify({ username, cols: term.cols, rows: term.rows }))
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
    // The session is opened once, when the page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        bgcolor: '#202124',
        color: '#e8eaed',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1,
          borderBottom: '1px solid #3c4043',
        }}
      >
        <TerminalIcon sx={{ fontSize: 18, color: '#9aa0a6' }} />
        <Typography sx={{ fontSize: 14 }}>{name}</Typography>
        <Box component="span" sx={{ color: '#9aa0a6', fontSize: 13 }}>
          {username}@{instance?.internalIp ?? '…'}
        </Box>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          sx={{ color: '#8ab4f8' }}
          onClick={() => {
            socketRef.current?.close()
            window.close()
          }}
        >
          Disconnect
        </Button>
      </Box>
      <Box
        ref={terminalRef}
        sx={{ flex: 1, minHeight: 0, p: 1, '& .xterm': { height: '100%' } }}
      />
    </Box>
  )
}
