import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Box, Button, IconButton, Menu, MenuItem, Radio, Typography } from '@mui/material'
import TerminalIcon from '@mui/icons-material/Terminal'
import SettingsIcon from '@mui/icons-material/Settings'
import ArrowRightIcon from '@mui/icons-material/ArrowRight'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api/client'
import { sshUsername, useSession } from '../user'
import {
  savedFontSize,
  savedThemeID,
  saveFontSize,
  saveThemeID,
  terminalThemes,
  themeFor,
  fontSizes,
} from '../terminalThemes'

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
  const { user } = useSession()
  const username = sshUsername(user)

  const terminalRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)

  const { data: instance } = useQuery({
    queryKey: ['instance', name],
    queryFn: () => api.getInstance(name),
    enabled: Boolean(name),
  })

  // Kept so the menu can restyle the running terminal — xterm applies
  // a new theme to the existing screen, so switching mid-session
  // doesn't cost you your scrollback or your connection.
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [themeID, setThemeID] = useState(savedThemeID)
  const [fontSize, setFontSize] = useState(savedFontSize)
  const [settings, setSettings] = useState<null | HTMLElement>(null)
  const [themeMenu, setThemeMenu] = useState<null | HTMLElement>(null)
  const [fontMenu, setFontMenu] = useState<null | HTMLElement>(null)
  // Picking from a flyout closes the whole stack, not just the flyout.
  const closeSettings = () => {
    setThemeMenu(null)
    setFontMenu(null)
    setSettings(null)
  }

  useEffect(() => {
    if (!terminalRef.current) return
    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: savedFontSize(),
      cursorBlink: true,
      theme: themeFor(savedThemeID()).theme,
    })
    termRef.current = term
    const fit = new FitAddon()
    fitRef.current = fit
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
  }, [name, username])

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        bgcolor: 'text.primary',
        color: 'surface.faint',
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
        <IconButton
          size="small"
          sx={{ color: '#9aa0a6' }}
          aria-label="Terminal settings"
          onClick={(e) => setSettings(e.currentTarget)}
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
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

      {/* Two levels, the way a terminal's settings menu is shaped:
          the top level is what you can change, the flyout is what you
          can change it to. Ten themes and six sizes in one list is a
          wall to read every time you want one of them. */}
      <Menu
        anchorEl={settings}
        open={Boolean(settings)}
        onClose={closeSettings}
        slotProps={{ paper: { sx: { minWidth: 180 } } }}
      >
        <MenuItem dense onClick={(e) => setThemeMenu(e.currentTarget)}>
          Theme
          <Box sx={{ flex: 1 }} />
          <ArrowRightIcon fontSize="small" sx={{ ml: 2, color: 'text.secondary' }} />
        </MenuItem>
        <MenuItem dense onClick={(e) => setFontMenu(e.currentTarget)}>
          Font size
          <Box sx={{ flex: 1 }} />
          <ArrowRightIcon fontSize="small" sx={{ ml: 2, color: 'text.secondary' }} />
        </MenuItem>
      </Menu>

      {/* Flyouts open to the left: the gear sits at the right edge. */}
      <Menu
        anchorEl={themeMenu}
        open={Boolean(themeMenu)}
        onClose={() => setThemeMenu(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {terminalThemes.map((option) => (
          <MenuItem
            key={option.id}
            dense
            sx={{ py: 0 }}
            onClick={() => {
              setThemeID(option.id)
              saveThemeID(option.id)
              if (termRef.current) termRef.current.options.theme = option.theme
              closeSettings()
            }}
          >
            <Radio size="small" checked={option.id === themeID} sx={{ p: 0.5, mr: 1 }} />
            {option.label}
          </MenuItem>
        ))}
      </Menu>

      <Menu
        anchorEl={fontMenu}
        open={Boolean(fontMenu)}
        onClose={() => setFontMenu(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {fontSizes.map((size) => (
          <MenuItem
            key={size}
            dense
            sx={{ py: 0 }}
            onClick={() => {
              setFontSize(size)
              saveFontSize(size)
              if (termRef.current) {
                termRef.current.options.fontSize = size
                fitRef.current?.fit()
              }
              closeSettings()
            }}
          >
            <Radio size="small" checked={size === fontSize} sx={{ p: 0.5, mr: 1 }} />
            {size}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )
}
