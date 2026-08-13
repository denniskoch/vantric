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
import DatasetIcon from '@mui/icons-material/Dataset'
import ViewInArIcon from '@mui/icons-material/ViewInAr'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'

export interface SectionItem {
  label: string
  icon: SvgIconComponent
  to: string
  /** one-line summary, shown on the section landing page */
  hint?: string
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
  /** one-line description for the section landing page */
  description: string
  /** what the section will offer, while it has no pages yet */
  planned?: string[]
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
    home: '/compute/overview',
    description:
      'Virtual machines and containers on your hypervisors, with the images, disks and templates behind them.',
    items: [
      { label: 'Overview', icon: DashboardIcon, to: '/compute/overview' },
    ],
    groups: [
      {
        label: 'Virtual machines',
        items: [
          {
            label: 'VM instances',
            icon: ComputerIcon,
            to: '/compute/instances',
            hint: 'Create, start, stop and inspect virtual machines',
          },
          {
            label: 'CT instances',
            icon: Inventory2Icon,
            to: '/compute/containers',
            hint: 'System containers (LXC) discovered on your servers',
          },
        ],
      },
      {
        label: 'Storage',
        items: [
          { label: 'Disks', icon: LayersIcon, to: '/compute/disks', hint: 'Virtual disks attached to instances' },
          { label: 'Snapshots', icon: PhotoCameraIcon, to: '/compute/snapshots', hint: 'Point-in-time VM snapshots' },
          {
            label: 'VM Templates',
            icon: AlbumIcon,
            to: '/compute/vm-templates',
            hint: 'Sources instances are cloned from; build new ones from cloud images',
          },
          { label: 'CT Templates', icon: ArchiveIcon, to: '/compute/ct-templates', hint: 'Root filesystems containers are created from' },
          { label: 'Cloud images', icon: CloudUploadIcon, to: '/compute/cloud-images', hint: 'Disk images to build VM templates from' },
          { label: 'ISOs', icon: DiscFullIcon, to: '/compute/isos', hint: 'Installer media, imported by URL or upload' },
          { label: 'Datastores', icon: FolderSpecialIcon, to: '/compute/datastores', hint: 'Storage pools and their usage' },
        ],
      },
      {
        // Physical virtualization hosts (e.g. Proxmox nodes) live here.
        label: 'Bare Metal Solution',
        items: [
          {
            label: 'Servers',
            icon: DnsIcon,
            to: '/compute/servers',
            hint: 'Virtualization hosts backing everything else',
          },
        ],
      },
      {
        label: 'Settings',
        items: [
          {
            label: 'Machine types',
            icon: TuneIcon,
            to: '/compute/settings/machine-types',
            hint: 'Sizing presets offered when creating an instance',
          },
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
    description: 'Shared storage for the lab, beyond the disks attached to instances.',
    planned: [
      'Network shares (NFS, SMB) as first-class resources',
      'Object storage buckets',
      'Backup jobs and retention',
    ],
    comingSoon: true,
  },
  {
    id: 'network',
    label: 'Network',
    icon: LanIcon,
    prefix: '/network',
    home: '/network',
    items: [],
    groups: [],
    description: 'Bridges, VLANs and firewall rules across your hosts.',
    planned: [
      'Bridges and VLANs as managed resources, not just pickers',
      'Firewall rules per instance and per host',
      'IP address inventory',
    ],
    comingSoon: true,
  },
  {
    id: 'databases',
    label: 'Databases',
    icon: DatasetIcon,
    prefix: '/databases',
    home: '/databases',
    items: [],
    groups: [],
    description: 'Managed database instances, the way Cloud SQL presents them.',
    planned: [
      'Provision Postgres and MySQL instances from templates',
      'Scheduled backups and restore',
      'Connection details and users',
    ],
    comingSoon: true,
  },
  {
    id: 'docker',
    label: 'Docker',
    icon: ViewInArIcon,
    prefix: '/docker',
    home: '/docker',
    items: [],
    groups: [],
    description: 'Container workloads running on your Docker hosts.',
    planned: [
      'Containers and images per host',
      'Compose stacks as a deployable unit',
      'Registry credentials',
    ],
    comingSoon: true,
  },
  {
    id: 'dns',
    label: 'DNS',
    icon: TravelExploreIcon,
    prefix: '/dns',
    home: '/dns',
    items: [],
    groups: [],
    description: 'Internal name resolution for lab services.',
    planned: [
      'Zones and records',
      'Automatic records for new instances',
      'Upstream resolvers and split-horizon views',
    ],
    comingSoon: true,
  },
]

export function sectionFor(pathname: string): Section | undefined {
  return sections.find((s) => pathname.startsWith(s.prefix))
}
