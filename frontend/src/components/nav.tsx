import type { SvgIconComponent } from '@mui/icons-material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import ComputerIcon from '@mui/icons-material/Computer'
import AlbumIcon from '@mui/icons-material/Album'
import StorageIcon from '@mui/icons-material/Storage'
import LanIcon from '@mui/icons-material/Lan'
import MemoryIcon from '@mui/icons-material/Memory'
import DnsIcon from '@mui/icons-material/Dns'
import TuneIcon from '@mui/icons-material/Tune'
import LayersIcon from '@mui/icons-material/Layers'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import Inventory2Icon from '@mui/icons-material/Inventory2'
import DiscFullIcon from '@mui/icons-material/DiscFull'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial'
import ArchiveIcon from '@mui/icons-material/Archive'

export interface SectionItem {
  label: string
  icon: SvgIconComponent
  to: string
}

/** Collapsible group of items in a section's left nav (GCP-style). */
export interface SectionGroup {
  label: string
  items: SectionItem[]
}

export interface Section {
  id: string
  label: string
  icon: SvgIconComponent
  /** route prefix that marks this section active */
  prefix: string
  /** where the global menu lands you */
  home: string
  /** ungrouped entries at the top of the section nav */
  items: SectionItem[]
  /** collapsible groups below the ungrouped entries */
  groups: SectionGroup[]
  comingSoon?: boolean
}

// Global navigation: one entry per product section. Adding a section
// here gives it a global-menu entry and its own permanent left nav.
export const sections: Section[] = [
  {
    id: 'compute',
    label: 'Compute Engine',
    icon: MemoryIcon,
    prefix: '/compute',
    home: '/compute/instances',
    items: [
      { label: 'Overview', icon: DashboardIcon, to: '/compute/overview' },
    ],
    groups: [
      {
        label: 'Virtual machines',
        items: [
          { label: 'VM instances', icon: ComputerIcon, to: '/compute/instances' },
          { label: 'CT instances', icon: Inventory2Icon, to: '/compute/containers' },
        ],
      },
      {
        label: 'Storage',
        items: [
          { label: 'Disks', icon: LayersIcon, to: '/compute/disks' },
          { label: 'Snapshots', icon: PhotoCameraIcon, to: '/compute/snapshots' },
          { label: 'VM Templates', icon: AlbumIcon, to: '/compute/vm-templates' },
          { label: 'CT Templates', icon: ArchiveIcon, to: '/compute/ct-templates' },
          { label: 'Cloud images', icon: CloudUploadIcon, to: '/compute/cloud-images' },
          { label: 'ISOs', icon: DiscFullIcon, to: '/compute/isos' },
          { label: 'Datastores', icon: FolderSpecialIcon, to: '/compute/datastores' },
        ],
      },
      {
        // Physical virtualization hosts (e.g. Proxmox nodes) live here.
        label: 'Bare Metal Solution',
        items: [
          { label: 'Servers', icon: DnsIcon, to: '/compute/servers' },
        ],
      },
      {
        label: 'Settings',
        items: [
          { label: 'Machine types', icon: TuneIcon, to: '/compute/settings/machine-types' },
        ],
      },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: StorageIcon,
    prefix: '/storage',
    home: '/storage',
    items: [],
    groups: [],
    comingSoon: true,
  },
  {
    id: 'network',
    label: 'VPC Network',
    icon: LanIcon,
    prefix: '/network',
    home: '/network',
    items: [],
    groups: [],
    comingSoon: true,
  },
]

export function sectionFor(pathname: string): Section | undefined {
  return sections.find((s) => pathname.startsWith(s.prefix))
}
