import type { ReactNode } from 'react'
import DashboardIcon from '@mui/icons-material/Dashboard'
import ComputerIcon from '@mui/icons-material/Computer'
import AlbumIcon from '@mui/icons-material/Album'
import StorageIcon from '@mui/icons-material/Storage'
import LanIcon from '@mui/icons-material/Lan'
import MemoryIcon from '@mui/icons-material/Memory'

export interface SectionItem {
  label: string
  icon: ReactNode
  to: string
}

export interface Section {
  id: string
  label: string
  icon: ReactNode
  /** route prefix that marks this section active */
  prefix: string
  /** where the global menu lands you */
  home: string
  /** permanent left-nav entries while inside the section */
  items: SectionItem[]
  comingSoon?: boolean
}

// Global navigation: one entry per product section. Adding a section
// here gives it a global-menu entry and its own permanent left nav.
export const sections: Section[] = [
  {
    id: 'compute',
    label: 'Compute Engine',
    icon: <MemoryIcon fontSize="small" />,
    prefix: '/compute',
    home: '/compute/instances',
    items: [
      { label: 'Overview', icon: <DashboardIcon fontSize="small" />, to: '/compute/overview' },
      { label: 'VM instances', icon: <ComputerIcon fontSize="small" />, to: '/compute/instances' },
      { label: 'Images', icon: <AlbumIcon fontSize="small" />, to: '/compute/images' },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: <StorageIcon fontSize="small" />,
    prefix: '/storage',
    home: '/storage',
    items: [],
    comingSoon: true,
  },
  {
    id: 'network',
    label: 'VPC Network',
    icon: <LanIcon fontSize="small" />,
    prefix: '/network',
    home: '/network',
    items: [],
    comingSoon: true,
  },
]

export function sectionFor(pathname: string): Section | undefined {
  return sections.find((s) => pathname.startsWith(s.prefix))
}
