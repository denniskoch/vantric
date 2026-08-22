import { useState } from 'react'
import { Box, Button, ButtonGroup, IconButton, Menu, MenuItem, Tooltip } from '@mui/material'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import { connectionFor } from '../connect'
import { usePermissions } from '../user'
import type { Instance } from '../api/client'

/**
 * The way into a guest, as a split button: the obvious action on the
 * left, the other ways to do it under the caret — GCP's pattern.
 *
 * Two sizes of the same control. "compact" is the Connect column in the
 * instances table, where it has to sit in a dense row; "outlined" is
 * the instance detail view, where it's the first thing on the page and
 * looks like a button.
 *
 * THE ROLE CHECK LIVES HERE rather than at the call sites, for the same
 * reason the backend's is middleware: there are two call sites today and
 * the third is the one that forgets. A viewer is offered nothing — a
 * shell is not a read, whatever the HTTP verb behind it says — and the
 * backend refuses it regardless, since this decides what to OFFER and is
 * worth nothing on its own.
 */
export default function ConnectButton({
  instance,
  variant = 'compact',
}: {
  instance: Instance
  variant?: 'compact' | 'outlined'
}) {
  const [menu, setMenu] = useState<null | HTMLElement>(null)
  const [rdpMenu, setRdpMenu] = useState<null | HTMLElement>(null)
  const { canEdit } = usePermissions()
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

  // A desktop wants more room than a terminal, and the same detachment.
  const openDesktop = () => {
    window.open(
      `/compute/instances/${encodeURIComponent(instance.name)}/rdp`,
      `rdp-${instance.name}`,
      'width=1440,height=900,menubar=no,toolbar=no,location=no,status=no',
    )
  }

  const unavailable = running ? 'No address known yet' : 'Instance is not running'

  if (!canEdit) {
    const why = 'Connecting to a guest needs the editor role'
    if (outlined) {
      return (
        <Tooltip title={why}>
          <span>
            <Button variant="outlined" size="small" disabled>
              SSH
            </Button>
          </span>
        </Tooltip>
      )
    }
    return (
      <Tooltip title={why}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Box component="span" sx={{ color: 'text.secondary' }}>
            —
          </Box>
          <CaretSlot />
        </Box>
      </Tooltip>
    )
  }

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
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Box component="span" sx={{ color: 'text.secondary' }}>
            —
          </Box>
          <CaretSlot />
        </Box>
      </Tooltip>
    )
  }

  // RDP has no proxy here, so it stays a single button handing the URI
  // to whatever client the desktop registered.
  // RDP is proxied now, so it behaves like SSH: the button opens a
  // desktop in this console and the caret keeps the handoff to whatever
  // client the machine registered, for the times you want a real one.
  if (connection.kind === 'RDP') {
    const menu = (
      <Menu anchorEl={rdpMenu} open={Boolean(rdpMenu)} onClose={() => setRdpMenu(null)}>
        <MenuItem
          onClick={() => {
            setRdpMenu(null)
            openDesktop()
          }}
        >
          Open in browser window
        </MenuItem>
        <MenuItem
          onClick={() => {
            setRdpMenu(null)
            window.location.href = connection.href
          }}
        >
          Use another RDP client
        </MenuItem>
      </Menu>
    )
    if (outlined) {
      return (
        <>
          <ButtonGroup variant="outlined" size="small" disabled={!running}>
            <Button onClick={openDesktop} sx={{ px: 2 }}>
              RDP
            </Button>
            <Button
              onClick={(e) => setRdpMenu(e.currentTarget)}
              aria-label="Other ways to connect"
              sx={{ px: 0.5, minWidth: 32 }}
            >
              <ArrowDropDownIcon fontSize="small" />
            </Button>
          </ButtonGroup>
          {menu}
        </>
      )
    }
    return (
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Tooltip title={running ? 'Open a desktop' : 'Instance is not running'}>
          <span>
            <Button
              size="small"
              disabled={!running}
              onClick={openDesktop}
              sx={{ minWidth: 0, px: 1 }}
            >
              RDP
            </Button>
          </span>
        </Tooltip>
        <IconButton
          size="small"
          disabled={!running}
          onClick={(e) => setRdpMenu(e.currentTarget)}
          aria-label="Other ways to connect"
        >
          <ArrowDropDownIcon fontSize="small" />
        </IconButton>
        {menu}
      </Box>
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

/**
 * The caret's place in the Connect column, whether or not there is a
 * caret to put in it.
 *
 * `disabled` draws it greyed and dead; the default draws nothing at
 * all but still takes the width, so a row with no way in lines up with
 * the rows that have one. Rendering the same control either way is
 * what guarantees the widths match — a hand-measured spacer is a
 * number that goes stale the first time the icon size changes.
 */
function CaretSlot({ disabled }: { disabled?: boolean }) {
  return (
    <IconButton
      size="small"
      disabled
      aria-hidden
      tabIndex={-1}
      sx={disabled ? undefined : { visibility: 'hidden' }}
    >
      <ArrowDropDownIcon fontSize="small" />
    </IconButton>
  )
}
