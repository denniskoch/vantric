import { useState } from 'react'
import { Box, Button, ButtonGroup, IconButton, Menu, MenuItem, Tooltip } from '@mui/material'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import { connectionFor } from '../connect'
import type { Instance } from '../api/client'

/**
 * The way into a guest, as a split button: the obvious action on the
 * left, the other ways to do it under the caret — GCP's pattern.
 *
 * Two sizes of the same control. "compact" is the Connect column in the
 * instances table, where it has to sit in a dense row; "outlined" is
 * the instance detail view, where it's the first thing on the page and
 * looks like a button.
 */
export default function ConnectButton({
  instance,
  variant = 'compact',
}: {
  instance: Instance
  variant?: 'compact' | 'outlined'
}) {
  const [menu, setMenu] = useState<null | HTMLElement>(null)
  const connection = connectionFor(instance.osType, instance.internalIp, instance.name)
  const running = instance.status === 'RUNNING'
  const outlined = variant === 'outlined'

  // A terminal belongs in its own window: it outlives the page you
  // launched it from, and you'll want the console beside it.
  const openTerminal = () => {
    if (!connection) return
    window.open(
      connection.href,
      `ssh-${instance.name}`,
      'width=1024,height=640,menubar=no,toolbar=no,location=no,status=no',
    )
  }

  const unavailable = running ? 'No address known yet' : 'Instance is not running'

  if (!connection) {
    if (outlined) {
      // On the detail view there's room to say why rather than dash it.
      return (
        <Tooltip title={unavailable}>
          <span>
            <Button variant="outlined" size="small" disabled>
              SSH
            </Button>
          </span>
        </Tooltip>
      )
    }
    return (
      <Tooltip title={unavailable}>
        <Box component="span" sx={{ color: '#5f6368' }}>
          —
        </Box>
      </Tooltip>
    )
  }

  // RDP has no proxy here, so it stays a single button handing the URI
  // to whatever client the desktop registered.
  if (connection.kind === 'RDP') {
    return (
      <Tooltip title={running ? connection.command : 'Instance is not running'}>
        <span>
          <Button
            variant={outlined ? 'outlined' : 'text'}
            size="small"
            href={connection.href}
            disabled={!running}
            sx={outlined ? undefined : { minWidth: 0, px: 1 }}
          >
            RDP
          </Button>
        </span>
      </Tooltip>
    )
  }

  const items = (
    <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
      <MenuItem
        onClick={() => {
          setMenu(null)
          openTerminal()
        }}
      >
        Open in browser window
      </MenuItem>
      <MenuItem
        onClick={() => {
          setMenu(null)
          window.location.href = `ssh://${instance.internalIp}`
        }}
      >
        Use another SSH client
      </MenuItem>
    </Menu>
  )

  if (outlined) {
    return (
      <>
        <ButtonGroup variant="outlined" size="small" disabled={!running}>
          <Button onClick={openTerminal} sx={{ px: 2 }}>
            SSH
          </Button>
          <Button
            onClick={(e) => setMenu(e.currentTarget)}
            aria-label="Other ways to connect"
            sx={{ px: 0.5, minWidth: 32 }}
          >
            <ArrowDropDownIcon fontSize="small" />
          </Button>
        </ButtonGroup>
        {items}
      </>
    )
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Button size="small" disabled={!running} onClick={openTerminal} sx={{ minWidth: 0, px: 1 }}>
        SSH
      </Button>
      <IconButton
        size="small"
        disabled={!running}
        onClick={(e) => setMenu(e.currentTarget)}
        aria-label="Other ways to connect"
      >
        <ArrowDropDownIcon fontSize="small" />
      </IconButton>
      {items}
    </Box>
  )
}
