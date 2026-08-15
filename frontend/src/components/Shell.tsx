import { useEffect, useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Collapse,
  Drawer,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Divider,
  Toolbar,
  Typography,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import SearchIcon from '@mui/icons-material/Search'
import logoLight from '../assets/brand/kochlabs-logo-light.svg'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { sections, sectionFor } from './nav'
import { api } from '../api/client'
import { initialFor, useRefreshSession, useSession } from '../user'
import type { SectionItem } from './nav'


const SECTION_NAV_WIDTH = 256
const GLOBAL_NAV_WIDTH = 280

function NavItem({ item }: { item: SectionItem }) {
  const location = useLocation()
  return (
    <ListItemButton
      component={Link}
      to={item.to}
      selected={location.pathname.startsWith(item.to)}
      sx={{ mr: 1 }}
    >
      <ListItemIcon sx={{ minWidth: 36 }}>
        <item.icon fontSize="small" />
      </ListItemIcon>
      <ListItemText primary={item.label} />
    </ListItemButton>
  )
}

export default function Shell() {
  const [globalNavOpen, setGlobalNavOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [accountMenu, setAccountMenu] = useState<null | HTMLElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, loading, signedOut } = useSession()
  const refreshSession = useRefreshSession()

  const section = sectionFor(location.pathname)
  // A section with nothing to list gets no drawer — the Cloud overview
  // is one page, and a nav rail holding a single link to it would only
  // take width from the thing it links to.
  const sectionNav = section && (section.items.length > 0 || section.groups.length > 0)
      ? section
      : undefined

  // The gate. Everything inside the shell needs a session, so an
  // expired one sends you to sign in rather than filling the console
  // with 401s — and remembers where you were going.
  useEffect(() => {
    if (signedOut) {
      navigate('/signin', { replace: true, state: { from: location.pathname } })
    }
  }, [signedOut, navigate, location.pathname])

  if (loading || signedOut) {
    return <Box sx={{ height: '100vh', bgcolor: '#f8f9fa' }} />
  }

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar variant="dense" sx={{ gap: 1, minHeight: 48 }}>
          <IconButton
            edge="start"
            onClick={() => setGlobalNavOpen((open) => !open)}
            aria-label={globalNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={globalNavOpen}
            size="small"
          >
            <MenuIcon />
          </IconButton>
          <Box
            component="img"
            src={logoLight}
            alt="KochLabs"
            sx={{ height: 18, display: 'block' }}
          />
          <Typography variant="h6" sx={{ color: '#5f6368', fontWeight: 400, mr: 1 }}>
            Cloud
          </Typography>
          <Box
            sx={{
              flex: 1,
              maxWidth: 720,
              mx: 'auto',
              display: 'flex',
              alignItems: 'center',
              bgcolor: '#f1f3f4',
              borderRadius: 1,
              px: 1.5,
              py: 0.5,
            }}
          >
            <SearchIcon fontSize="small" sx={{ mr: 1, color: '#5f6368' }} />
            <InputBase
              placeholder="Search (/) for resources"
              fullWidth
              sx={{ fontSize: 13 }}
            />
          </Box>
          <Box sx={{ flex: 1 }} />

          {/* Account. Reads the live session; the menu's actions are
              real now that there's something to sign out of. */}
          <IconButton
            size="small"
            onClick={(e) => setAccountMenu(e.currentTarget)}
            aria-label={`Account: ${user?.name || user?.email || 'signed out'}`}
            aria-haspopup="menu"
          >
            <Avatar sx={{ width: 30, height: 30, bgcolor: '#1a73e8', fontSize: 14 }}>
              {initialFor(user)}
            </Avatar>
          </IconButton>
          <Menu
            anchorEl={accountMenu}
            open={Boolean(accountMenu)}
            onClose={() => setAccountMenu(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { width: 300 } } }}
          >
            <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Avatar sx={{ width: 36, height: 36, bgcolor: '#1a73e8', fontSize: 16 }}>
                {initialFor(user)}
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, color: '#202124' }}>
                  {user?.name || 'Signed out'}
                </Typography>
                <Typography sx={{ fontSize: 12, color: '#5f6368' }}>
                  {user?.email}
                </Typography>
              </Box>
              {user && (
                <Chip label={user.role} size="small" sx={{ ml: 'auto', fontSize: 10, height: 18 }} />
              )}
            </Box>
            <Divider />
            <MenuItem
              sx={{ fontSize: 13 }}
              onClick={() => {
                setAccountMenu(null)
                navigate('/iam/account')
              }}
            >
              My account
            </MenuItem>
            <MenuItem
              sx={{ fontSize: 13 }}
              onClick={() => {
                setAccountMenu(null)
                navigate('/iam/users')
              }}
            >
              Manage accounts
            </MenuItem>
            <MenuItem
              sx={{ fontSize: 13 }}
              onClick={async () => {
                setAccountMenu(null)
                await api.logout()
                await refreshSession()
                navigate('/signin', { replace: true })
              }}
            >
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Global navigation: how you move between Lab Cloud sections. */}
      <Drawer
        variant="temporary"
        open={globalNavOpen}
        onClose={() => setGlobalNavOpen(false)}
        sx={{
          zIndex: (t) => t.zIndex.drawer, // stays under the app bar
          '& .MuiDrawer-paper': { width: GLOBAL_NAV_WIDTH },
        }}
      >
        <Toolbar variant="dense" sx={{ minHeight: 48 }} />
        <List dense>
          {sections.map((s) => (
            <ListItemButton
              key={s.id}
              selected={section?.id === s.id}
              onClick={() => {
                navigate(s.home)
                setGlobalNavOpen(false)
              }}
              sx={{ mr: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <s.icon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={s.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>

      {/* Section navigation: permanent while inside a section. */}
      {sectionNav && (
        <Drawer
          variant="permanent"
          sx={{
            width: SECTION_NAV_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: SECTION_NAV_WIDTH,
              boxSizing: 'border-box',
              borderRight: '1px solid #dadce0',
            },
          }}
        >
          <Toolbar variant="dense" sx={{ minHeight: 48 }} />
          {/* Section header, GCP-style: product icon + large title */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, pt: 2, pb: 1.5 }}>
            <sectionNav.icon sx={{ fontSize: 28, color: '#5f6368' }} />
            <Typography sx={{ fontSize: 18, color: '#202124' }}>
              {sectionNav.label}
            </Typography>
          </Box>
          <List dense>
            {sectionNav.items.map((item) => (
              <NavItem key={item.to} item={item} />
            ))}
            {sectionNav.groups.map((group) => {
              const isCollapsed = collapsed[group.label] ?? false
              return (
                <Box key={group.label}>
                  <ListItemButton
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [group.label]: !isCollapsed }))
                    }
                    sx={{ mt: 0.5 }}
                  >
                    <ListItemText
                      primary={group.label}
                      slotProps={{
                        primary: { sx: { fontWeight: 500, color: '#202124' } },
                      }}
                    />
                    {isCollapsed ? (
                      <ExpandMoreIcon fontSize="small" sx={{ color: '#5f6368' }} />
                    ) : (
                      <ExpandLessIcon fontSize="small" sx={{ color: '#5f6368' }} />
                    )}
                  </ListItemButton>
                  <Collapse in={!isCollapsed} timeout="auto">
                    <List dense disablePadding sx={{ pl: 1 }}>
                      {group.items.map((item) => (
                        <NavItem key={item.to} item={item} />
                      ))}
                    </List>
                  </Collapse>
                </Box>
              )
            })}
          </List>
        </Drawer>
      )}

      <Box
        component="main"
        sx={{ flexGrow: 1, overflow: 'auto', bgcolor: '#fff', minWidth: 0 }}
      >
        <Toolbar variant="dense" sx={{ minHeight: 48 }} />
        <Outlet />
      </Box>
    </Box>
  )
}
