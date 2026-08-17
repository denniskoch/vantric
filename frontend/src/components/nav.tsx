import type { SvgIconComponent } from '@mui/icons-material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import HomeIcon from '@mui/icons-material/Home'
import ComputerIcon from '@mui/icons-material/Computer'
import AlbumIcon from '@mui/icons-material/Album'
import StorageIcon from '@mui/icons-material/Storage'
import LanIcon from '@mui/icons-material/Lan'
import MemoryIcon from '@mui/icons-material/Memory'
import DnsIcon from '@mui/icons-material/Dns'
import LayersIcon from '@mui/icons-material/Layers'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import BackupIcon from '@mui/icons-material/Backup'
import Inventory2Icon from '@mui/icons-material/Inventory2'
import DiscFullIcon from '@mui/icons-material/DiscFull'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial'
import ArchiveIcon from '@mui/icons-material/Archive'
import DatasetIcon from '@mui/icons-material/Dataset'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import PublicIcon from '@mui/icons-material/Public'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import TableChartIcon from '@mui/icons-material/TableChart'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import FingerprintIcon from '@mui/icons-material/Fingerprint'
import PersonIcon from '@mui/icons-material/Person'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import GroupIcon from '@mui/icons-material/Group'
import AppsIcon from '@mui/icons-material/Apps'
import DevicesIcon from '@mui/icons-material/Devices'
import HubIcon from '@mui/icons-material/Hub'
import HistoryIcon from '@mui/icons-material/History'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import BugReportIcon from '@mui/icons-material/BugReport'
import DownloadIcon from '@mui/icons-material/Download'
import DevicesOtherIcon from '@mui/icons-material/DevicesOther'
import { createSvgIcon } from '@mui/material/utils'
import { siDocker } from 'simple-icons'

// The Docker section is Docker, so it gets the whale. createSvgIcon
// wraps the path so it behaves like every other MUI icon here — sized
// and coloured by the list item rather than carrying brand colour.
// Sections that span engines (Databases) keep a generic icon: an
// elephant would claim PostgreSQL for a list that also holds MySQL.
const DockerIcon = createSvgIcon(<path d={siDocker.path} />, 'Docker')

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
}

// Global navigation: one entry per product section. Adding a section
// here gives it a global-menu entry and its own permanent left nav.
export const sections: Section[] = [
  {
    // The front door, and first for that reason: the only page that
    // answers "what's wrong right now" without knowing where to look.
    // It has no left nav of its own — one entry pointing at the page
    // you're already on is a drawer that exists to say nothing — so
    // Shell gives a section with no items the full window.
    id: 'overview',
    label: 'Cloud overview',
    icon: HomeIcon,
    prefix: '/overview',
    home: '/overview',
    description:
      'Problems worth your attention, and how much of everything the lab is running.',
    items: [],
    groups: [],
  },
  {
    id: 'compute',
    label: 'Compute',
    icon: MemoryIcon,
    prefix: '/compute',
    home: '/compute/overview',
    description:
      'Virtual machines and containers on your hypervisors, with the images, disks and templates behind them.',
    items: [{ label: 'Overview', icon: DashboardIcon, to: '/compute/overview' }],
    groups: [
      {
        // Not "Virtual machines": half of what's in here isn't one.
        label: 'Instances',
        items: [
          {
            label: 'VM instances',
            icon: ComputerIcon,
            to: '/compute/instances',
            hint: 'Create, start, stop and inspect virtual machines',
          },
          {
            // "Container", not "CT" or "LXC". CT is Proxmox's own
            // shorthand and reads as nothing beside VM; LXC would name
            // the UI after one implementation of hypervisor.Container-
            // Driver, which exists so a backend's containers needn't
            // be LXC at all.
            label: 'Container instances',
            icon: Inventory2Icon,
            to: '/compute/containers',
            hint: 'System containers discovered on your servers',
          },
        ],
      },
      {
        // Storage split in two. Eight entries answered two different
        // questions — what a running guest is using, and what a new
        // one can be built from — interleaved in one list.
        label: 'Storage',
        items: [
          { label: 'Datastores', icon: FolderSpecialIcon, to: '/compute/datastores', hint: 'Storage pools everything else sits on' },
          { label: 'Disks', icon: LayersIcon, to: '/compute/disks', hint: 'Virtual disks attached to instances' },
          { label: 'Snapshots', icon: PhotoCameraIcon, to: '/compute/snapshots', hint: 'Point-in-time VM snapshots' },
          {
            label: 'Backups',
            icon: BackupIcon,
            to: '/compute/backups',
            hint: 'Guest backup archives held on your datastores',
          },
        ],
      },
      {
        label: 'Images and media',
        items: [
          {
            label: 'VM templates',
            icon: AlbumIcon,
            to: '/compute/vm-templates',
            hint: 'Sources instances are cloned from; build new ones from cloud images',
          },
          { label: 'Container templates', icon: ArchiveIcon, to: '/compute/ct-templates', hint: 'Root filesystems containers are created from' },
          { label: 'Cloud images', icon: CloudUploadIcon, to: '/compute/cloud-images', hint: 'Disk images to build VM templates from' },
          { label: 'ISOs', icon: DiscFullIcon, to: '/compute/isos', hint: 'Installer media, imported by URL or upload' },
        ],
      },
      {
        // The backend and what it exposes. Hypervisors are credentials,
        // the same shape as DNS providers; zones are the hosts those
        // credentials reach — infrastructure you check when something
        // is wrong, rather than a place you work, which is why this is
        // the bottom of the nav and not the top.
        label: 'Settings',
        items: [
          {
            label: 'Zones',
            icon: LanIcon,
            to: '/compute/zones',
            hint: 'The virtualization hosts your guests run on, and how loaded they are',
          },
          {
            label: 'Hypervisors',
            icon: DnsIcon,
            to: '/compute/settings/hypervisors',
            hint: 'Virtualization hosts backing everything else',
          },
        ],
      },
    ],
  },
  {
    // Devices, not Compute: Compute means machines this console runs,
    // and an inventory service holds laptops and bare metal too. The
    // correlation between the two lists is what this section is for.
    id: 'devices',
    label: 'Devices',
    icon: DevicesOtherIcon,
    prefix: '/devices',
    home: '/devices/overview',
    description:
      'Machines your inventory service tracks, physical and virtual.',
    items: [{ label: 'Overview', icon: DashboardIcon, to: '/devices/overview' }],
    groups: [
      {
        label: 'Inventory',
        items: [
          {
            label: 'Hosts',
            icon: FactCheckIcon,
            to: '/devices/hosts',
            hint: 'Every machine an agent reports on, and which are guests here',
          },
          {
            label: 'Vulnerabilities',
            icon: BugReportIcon,
            to: '/devices/vulnerabilities',
            hint: 'Known CVEs across the estate, exploited ones first',
          },
          {
            label: 'Installers',
            icon: DownloadIcon,
            to: '/devices/installers',
            hint: 'Agent packages a new machine can fetch with one command',
          },
        ],
      },
      {
        label: 'Settings',
        items: [
          {
            label: 'Inventory service',
            icon: DnsIcon,
            to: '/devices/settings/inventory',
            hint: 'The agent fleet this section reads (FleetDM)',
          },
          {
            label: 'Vulnerability data',
            icon: BugReportIcon,
            to: '/devices/settings/enrichment',
            hint: 'Where CVE descriptions and scores come from, and how fast',
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
    home: '/storage/overview',
    items: [{ label: 'Overview', icon: DashboardIcon, to: '/storage/overview' }],
    groups: [],
    description: 'Shared storage for the lab, beyond the disks attached to instances.',
  },
  {
    id: 'network',
    label: 'Network',
    icon: LanIcon,
    prefix: '/network',
    home: '/network/overview',
    items: [
      { label: 'Overview', icon: DashboardIcon, to: '/network/overview' },
      {
        // Deliberately outside the UniFi group: these are this
        // console's own records, and one of them may eventually come
        // from somewhere that isn't the controller.
        label: 'Subnets',
        icon: LanIcon,
        to: '/network/subnets',
        hint: 'Address ranges and what each one is for',
      },
    ],
    groups: [
      {
        // The controller's own vocabulary, so the two consoles read
        // the same way round.
        label: 'UniFi Network',
        items: [
          {
            label: 'Networks',
            icon: HubIcon,
            to: '/network/networks',
            hint: 'LANs and VLANs, their subnets and DHCP ranges',
          },
          {
            label: 'Clients',
            icon: DevicesIcon,
            to: '/network/clients',
            hint: 'What holds an address, leased or reserved',
          },
          {
            label: 'Controller',
            icon: VpnKeyIcon,
            to: '/network/controllers',
            hint: 'The network controller this console reads',
          },
        ],
      },
    ],
    description:
      'The networks your lab runs on — VLANs and their subnets, what holds an address, and the hardware carrying it.',
  },
  {
    id: 'databases',
    label: 'Databases',
    icon: DatasetIcon,
    prefix: '/databases',
    home: '/databases/overview',
    items: [{ label: 'Overview', icon: DashboardIcon, to: '/databases/overview' }],
    groups: [
      {
        label: 'SQL',
        items: [
          {
            label: 'Instances',
            icon: StorageIcon,
            to: '/databases/instances',
            hint: 'Database servers this console connects to',
          },
          {
            label: 'Databases',
            icon: TableChartIcon,
            to: '/databases/databases',
            hint: 'Every database across your instances',
          },
        ],
      },
    ],
    description:
      'Database servers running in your lab, with the databases, users and connections inside them.',
  },
  {
    id: 'docker',
    label: 'Docker',
    icon: DockerIcon,
    prefix: '/docker',
    home: '/docker/overview',
    items: [{ label: 'Overview', icon: DashboardIcon, to: '/docker/overview' }],
    groups: [],
    description: 'Container workloads running on your Docker hosts.',
  },
  {
    // This console's own access control: who may sign in here and what
    // they may do. Distinct from Identity Platform, which manages the
    // identity provider the lab's services authenticate against.
    id: 'iam',
    label: 'IAM & Admin',
    icon: AdminPanelSettingsIcon,
    prefix: '/iam',
    home: '/iam/overview',
    items: [{ label: 'Overview', icon: DashboardIcon, to: '/iam/overview' }],
    groups: [
      {
        label: 'Access',
        items: [
          {
            label: 'My account',
            icon: AccountCircleIcon,
            to: '/iam/account',
            hint: 'Your profile, password and SSH key',
          },
          {
            label: 'Users',
            icon: PersonIcon,
            to: '/iam/users',
            hint: 'Accounts that can sign in to this console',
          },
          {
            label: 'Single sign-on',
            icon: VpnKeyIcon,
            to: '/iam/sign-on',
            hint: "Sign in through the lab's identity provider",
          },
          {
            label: 'Activity',
            icon: HistoryIcon,
            to: '/iam/activity',
            hint: 'Every change made here, and who made it',
          },
        ],
      },
    ],
    description:
      'Who can use this console and what they can do.',
  },
  {
    id: 'identity',
    label: 'Identity Platform',
    icon: FingerprintIcon,
    prefix: '/identity',
    home: '/identity/overview',
    items: [{ label: 'Overview', icon: DashboardIcon, to: '/identity/overview' }],
    groups: [
      {
        label: 'Directory',
        items: [
          {
            label: 'Users',
            icon: PersonIcon,
            to: '/identity/users',
            hint: 'Accounts that can sign in to your services',
          },
          {
            label: 'Groups',
            icon: GroupIcon,
            to: '/identity/groups',
            hint: 'What membership grants, and who has it',
          },
        ],
      },
      {
        label: 'Access',
        items: [
          {
            label: 'Applications',
            icon: AppsIcon,
            to: '/identity/applications',
            hint: 'Services users sign in to through this provider',
          },
          {
            label: 'Events',
            icon: HistoryIcon,
            to: '/identity/events',
            hint: 'Logins, failures and changes, newest first',
          },
        ],
      },
      {
        label: 'Settings',
        items: [
          {
            label: 'Providers',
            icon: VpnKeyIcon,
            to: '/identity/providers',
            hint: 'The identity service this console reads',
          },
        ],
      },
    ],
    description:
      'The identity provider your lab services sign in through — users, groups, applications and login events.',
  },
  {
    id: 'dns',
    label: 'DNS',
    icon: TravelExploreIcon,
    prefix: '/dns',
    home: '/dns/overview',
    items: [{ label: 'Overview', icon: DashboardIcon, to: '/dns/overview' }],
    groups: [
      {
        label: 'Zones',
        items: [
          {
            label: 'Zones',
            icon: PublicIcon,
            to: '/dns/zones',
            hint: 'Domains managed through your DNS providers',
          },
        ],
      },
      {
        label: 'Settings',
        items: [
          {
            label: 'Providers',
            icon: VpnKeyIcon,
            to: '/dns/providers',
            hint: 'DNS accounts this console manages zones through',
          },
        ],
      },
    ],
    description: 'Internal name resolution for lab services.',
  },
]

export function sectionFor(pathname: string): Section | undefined {
  return sections.find((s) => pathname.startsWith(s.prefix))
}
