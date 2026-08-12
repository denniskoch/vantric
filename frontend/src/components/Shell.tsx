import { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  AppBar,
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import CloudIcon from '@mui/icons-material/Cloud'
import SearchIcon from '@mui/icons-material/Search'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import { useProject } from '../project'
import { sections, sectionFor } from './nav'

const SECTION_NAV_WIDTH = 256
const GLOBAL_NAV_WIDTH = 280

export default function Shell() {
  const [globalNavOpen, setGlobalNavOpen] = useState(false)
  const [projectMenu, setProjectMenu] = useState<null | HTMLElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const { projects, current, setCurrent } = useProject()

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
          <Button
            size="small"
            variant="outlined"
            endIcon={<ArrowDropDownIcon />}
            onClick={(e) => setProjectMenu(e.currentTarget)}
            sx={{ color: '#202124', borderColor: '#dadce0' }}
          >
            {current?.displayName ?? 'Select project'}
          </Button>
          <Menu
            anchorEl={projectMenu}
            open={Boolean(projectMenu)}
            onClose={() => setProjectMenu(null)}
          >
            {projects.map((p) => (
              <MenuItem
                key={p.id}
                selected={p.id === current?.id}
                onClick={() => {
                  setCurrent(p)
                  setProjectMenu(null)
                }}
              >
                {p.displayName}
              </MenuItem>
            ))}
          </Menu>
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
              <ListItemIcon sx={{ minWidth: 36 }}>{s.icon}</ListItemIcon>
              <ListItemText primary={s.label} />
              {s.comingSoon && (
                <Chip label="soon" size="small" sx={{ fontSize: 10, height: 18 }} />
              )}
            </ListItemButton>
          ))}
        </List>
      </Drawer>

      {/* Section navigation: permanent while inside a section. */}
      {section && section.items.length > 0 && (
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
          <List
            dense
            subheader={
              <ListSubheader sx={{ fontSize: 12, lineHeight: '32px' }}>
                {section.label}
              </ListSubheader>
            }
          >
            {section.items.map((item) => (
              <ListItemButton
                key={item.to}
                component={Link}
                to={item.to}
                selected={location.pathname.startsWith(item.to)}
                sx={{ mr: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            ))}
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
