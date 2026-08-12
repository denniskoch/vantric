import { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  AppBar,
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
  Toolbar,
  Typography,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import CloudIcon from '@mui/icons-material/Cloud'
import SearchIcon from '@mui/icons-material/Search'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { sections, sectionFor } from './nav'
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
  const location = useLocation()
  const navigate = useNavigate()

  const section = sectionFor(location.pathname)

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar variant="dense" sx={{ gap: 1, minHeight: 48 }}>
          <IconButton edge="start" onClick={() => setGlobalNavOpen(true)} size="small">
            <MenuIcon />
          </IconButton>
          <CloudIcon sx={{ color: '#1a73e8' }} />
          <Typography variant="h6" sx={{ color: '#5f6368', fontWeight: 400, mr: 1 }}>
            Lab Cloud
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
              disabled={s.comingSoon}
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
              {s.comingSoon && (
                <Chip label="soon" size="small" sx={{ fontSize: 10, height: 18 }} />
              )}
            </ListItemButton>
          ))}
        </List>
      </Drawer>

      {/* Section navigation: permanent while inside a section. */}
      {section && (section.items.length > 0 || section.groups.length > 0) && (
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
            <section.icon sx={{ fontSize: 28, color: '#5f6368' }} />
            <Typography sx={{ fontSize: 18, color: '#202124' }}>
              {section.label}
            </Typography>
          </Box>
          <List dense>
            {section.items.map((item) => (
              <NavItem key={item.to} item={item} />
            ))}
            {section.groups.map((group) => {
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
