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
import EventRepeatIcon from '@mui/icons-material/EventRepeat'
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
import PaletteIcon from '@mui/icons-material/Palette'
import FingerprintIcon from '@mui/icons-material/Fingerprint'
import PersonIcon from '@mui/icons-material/Person'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import GroupIcon from '@mui/icons-material/Group'
import AppsIcon from '@mui/icons-material/Apps'
import GridViewIcon from '@mui/icons-material/GridView'
import DevicesIcon from '@mui/icons-material/Devices'
import ShieldIcon from '@mui/icons-material/Shield'
import HubIcon from '@mui/icons-material/Hub'
import HistoryIcon from '@mui/icons-material/History'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import BugReportIcon from '@mui/icons-material/BugReport'
import DownloadIcon from '@mui/icons-material/Download'
import DevicesOtherIcon from '@mui/icons-material/DevicesOther'
import PsychologyIcon from '@mui/icons-material/Psychology'
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart'
import PaidIcon from '@mui/icons-material/Paid'
import SpeedIcon from '@mui/icons-material/Speed'
import PriceChangeIcon from '@mui/icons-material/PriceChange'
import SettingsEthernetIcon from '@mui/icons-material/SettingsEthernet'
import ReportProblemIcon from '@mui/icons-material/ReportProblem'
import { createSvgIcon } from '@mui/material/utils'
import { siDocker } from 'simple-icons'

// The Docker section is Docker, so it gets the whale. createSvgIcon
// wraps the path so it behaves like every other MUI icon here — sized
// and coloured by the list item rather than carrying brand colour.
// Sections that span engines (Databases) keep a generic icon: an
// elephant would claim PostgreSQL for a list that also holds MySQL.
const DockerIcon = createSvgIcon(<path d={siDocker.path} />, 'Docker')

// A bucket, drawn rather than borrowed. MUI has no pail, and the nearest
// candidates all read as something else at 20px — a basket, a box, a bin
// — so this is the same move brands.ts makes for the Windows mark and
// the whale above: when the library hasn't got the shape, draw it. A rim
// and a tapering body is the whole thing.
const BucketIcon = createSvgIcon(
  <path d="M12 2a5 5 0 0 0-5 5h1.7a3.3 3.3 0 0 1 6.6 0H17a5 5 0 0 0-5-5zM3 8h18v3.2H3zM5.2 12.4h13.6L17.2 22H6.8z" />,
  'Bucket',
)

import MenuBookIcon from '@mui/icons-material/MenuBook'
import ArticleIcon from '@mui/icons-material/Article'
import { docs } from '../docs'

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
// THE ORDER IS A WALK THROUGH THE LAB, not a ranking. It runs: what is
// wrong (overview), where you were going (shortcuts), how you find out
// something is wrong (security, monitoring), the machines, their data,
// how they connect, the services running on them, and last this console
// itself — IAM and the documentation describe the app rather than the
// lab, and belong at the bottom for that reason.
//
// THE PAIRS ARE THE POINT, and each was split apart before: DNS sat six
// entries from Network, Docker five from Compute, and Security and
// Monitoring — the two sections that answer the same question — were at
// opposite ends of the list.

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
    // Second, and personal: after "what's wrong" comes "where was I
    // going", before any of the sections that describe the lab.
    //
    // It is the one section that isn't a view onto another tool's API,
    // because it is the view onto the gaps between them — a NAS's own
    // UI, a SaaS account with no integration here yet. No left nav: one
    // page, and Shell gives a section with no items the full window.
    id: 'shortcuts',
    label: 'Shortcuts',
    icon: GridViewIcon,
    prefix: '/shortcuts',
    home: '/shortcuts',
    // No landing page renders this, and the page itself needs no
    // caption: a grid of labelled tiles says what it is.
    description: '',
    items: [],
    groups: [],
  },
  {
    // Third, above Compute: the overview answers "is anything broken",
    // this is where "is anything exposed" will go.
    //
    // Google's name, kept deliberately — every other section here is
    // named for what it holds and this one for what it is, and it's the
    // phrase anyone who has used a cloud console already knows.
    //
    // Vulnerabilities moved here from Devices, where nobody would
    // think to look for a CVE. The split is agent vs meaning: Fleet and
    // the machines it reports on stay in Devices, what those findings
    // MEAN lives here — including where the scores come from.
    //
    // Vulnerabilities are what it holds TODAY, not what it is for. The
    // copy stays generic so the next kind of finding doesn't arrive to
    // a section describing itself as something else.
    id: 'security',
    label: 'Security',
    icon: ShieldIcon,
    prefix: '/security',
    home: '/security/overview',
    description: 'Security findings across the lab.',
    items: [],
    groups: [
      {
        label: 'Security Command Center',
        items: [
          {
            label: 'Overview',
            icon: DashboardIcon,
            to: '/security/overview',
            hint: 'Known-exploited vulnerabilities that are actually on your machines',
          },
          {
            // Moved out of Devices, where nobody looked for it: a CVE
            // is a security question that happens to be answered by
            // asking the machines. The agent that finds them stays in
            // Devices; what they MEAN lives here.
            label: 'Vulnerabilities',
            icon: BugReportIcon,
            to: '/security/vulnerabilities',
            hint: 'Known CVEs across the estate, exploited ones first',
          },
          {
            label: 'Host assessment',
            icon: FactCheckIcon,
            to: '/security/host-assessment',
            hint: 'One endpoint at a time',
          },
        ],
      },
      {
        label: 'Settings',
        items: [
          {
            label: 'Vulnerability data',
            icon: BugReportIcon,
            to: '/security/settings/vulnerability-data',
            hint: 'Where CVE descriptions and scores come from, and how fast',
          },
        ],
      },
    ],
  },
  {
    // Zabbix's own vocabulary for its pages — Problems, Hosts — the
    // same rule the Network section follows for UniFi's. Triggers,
    // templates and dashboards stay in Zabbix, where their blast
    // radius is; the daily 90% here is what's on fire and who isn't
    // being watched.
    id: 'monitoring',
    label: 'Monitoring',
    icon: MonitorHeartIcon,
    prefix: '/monitoring',
    home: '/monitoring/overview',
    items: [
      { label: 'Overview', icon: DashboardIcon, to: '/monitoring/overview' },
      {
        label: 'Problems',
        icon: ReportProblemIcon,
        to: '/monitoring/problems',
        hint: "What the monitoring service says is wrong, and since when",
      },
      {
        label: 'Hosts',
        icon: DevicesOtherIcon,
        to: '/monitoring/hosts',
        hint: 'What it watches, joined to the instances this console runs',
      },
    ],
    groups: [
      {
        label: 'Settings',
        items: [
          {
            label: 'Monitoring service',
            icon: MonitorHeartIcon,
            to: '/monitoring/settings/service',
            hint: 'The monitoring service this console reads',
          },
        ],
      },
    ],
    description:
      "What your monitoring service says is on fire, and which guests aren't being watched at all.",
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
            label: 'Virtual machines',
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
            label: 'Containers',
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
          {
            // After Backups, because the archives are what you look for
            // and the jobs are what you change when they aren't there.
            label: 'Backup schedules',
            icon: EventRepeatIcon,
            to: '/compute/backup-schedules',
            hint: "Your hypervisors' backup jobs, and what no job covers",
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
        // NOT "Settings", which every other section uses for the one
        // thing it holds: credentials. This group holds two things and
        // neither is a preference — a node is a read-only host, a
        // hypervisor is a stored credential. It sits at the bottom
        // because it's what you check when something is wrong, not
        // where you work.
        label: 'Infrastructure',
        items: [
          {
            label: 'Nodes',
            icon: LanIcon,
            to: '/compute/nodes',
            hint: 'The virtualization hosts your guests run on, and how loaded they are',
          },
          {
            label: 'Hypervisors',
            icon: DnsIcon,
            to: '/compute/hypervisors',
            hint: 'Virtualization hosts backing everything else',
          },
        ],
      },
    ],
  },
  {
    id: 'docker',
    label: 'Docker',
    icon: DockerIcon,
    prefix: '/docker',
    home: '/docker/overview',
    items: [{ label: 'Overview', icon: DashboardIcon, to: '/docker/overview' }],
    groups: [
      {
        label: 'Workloads',
        items: [
          {
            label: 'Containers',
            icon: Inventory2Icon,
            to: '/docker/containers',
            hint: 'Every container across your hosts, grouped by compose stack',
          },
        ],
      },
      {
        label: 'Resources',
        items: [
          {
            label: 'Images',
            icon: LayersIcon,
            to: '/docker/images',
            hint: 'What is pulled, what it costs in disk, and what nothing uses',
          },
          {
            label: 'Volumes',
            icon: FolderSpecialIcon,
            to: '/docker/volumes',
            hint: 'Where container data actually lives',
          },
          {
            label: 'Networks',
            icon: LanIcon,
            to: '/docker/networks',
            hint: 'Bridges the containers talk over',
          },
        ],
      },
      {
        label: 'Settings',
        items: [
          {
            label: 'Docker hosts',
            icon: SettingsEthernetIcon,
            to: '/docker/settings/hosts',
            hint: 'The daemons this console reaches, and the certificate each must present',
          },
        ],
      },
    ],
    description: 'Container workloads running on your Docker hosts.',
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
            // Split rather than filtered, for the reason VM instances
            // and container instances are: they list differently. A
            // laptop is identified by its serial and has no instance to
            // open; a guest is identified by the VM it is, which its
            // hostname won't tell you.
            label: 'Physical hosts',
            icon: DevicesIcon,
            to: '/devices/physical-hosts',
            hint: 'Laptops, desktops and bare metal — machines this console does not run',
          },
          {
            label: 'Virtual hosts',
            icon: FactCheckIcon,
            to: '/devices/virtual-hosts',
            hint: 'Guests running an agent, matched to instances by system UUID',
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
        ],
      },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: StorageIcon,
    prefix: '/storage',
    home: '/storage/buckets',
    items: [],
    groups: [
      {
        label: 'Object storage',
        items: [
          {
            label: 'Buckets',
            icon: BucketIcon,
            to: '/storage/buckets',
            hint: 'Object storage across the S3-compatible stores in your lab',
          },
          {
            // The store's API calls these users; this says access key,
            // because nothing signs in as one and this console already
            // has three other things called users.
            label: 'Access keys',
            icon: VpnKeyIcon,
            to: '/storage/keys',
            hint: 'Credentials for the S3 API, and what each one is allowed to reach',
          },
        ],
      },
      {
        // The credential, same slot every other section keeps it in.
        label: 'Settings',
        items: [
          {
            label: 'Object stores',
            icon: StorageIcon,
            to: '/storage/instances',
            hint: 'S3-compatible stores this console manages buckets through',
          },
        ],
      },
    ],
    description: 'Shared storage for the lab, beyond the disks attached to instances.',
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
    // GCP's own name for this group, which is the point: a lab that
    // calls an OpenAI key, a Claude key and an Ollama box on the desk
    // "the AI stuff" has the same problem a cloud does, and the same
    // question — what ran, against which model, at what cost.
    //
    // OBSERVABILITY FIRST, because that is the half no provider's own
    // console can answer: each one shows you its own traffic, and the
    // gateway in front of them all is the only thing that has seen the
    // lot. Everything else here — providers, keys, budgets, the local
    // models — is configuration that already has a home, and comes
    // second for that reason.
    id: 'ai',
    label: 'Artificial Intelligence',
    icon: PsychologyIcon,
    prefix: '/ai',
    home: '/ai/overview',
    items: [{ label: 'Overview', icon: DashboardIcon, to: '/ai/overview' }],
    groups: [
      {
        // The gateway is the section's subject, so its everyday pages
        // group under its name: what it served, what it can reach, and
        // who may ask it. Adding a provider or rotating an upstream key
        // stays in the gateway's own console — the daily 90% here, the
        // deep configuration where its blast radius is.
        label: 'Gateway',
        items: [
          {
            label: 'Requests',
            icon: HistoryIcon,
            to: '/ai/requests',
            hint: 'Every call the lab made to a model, and what answered',
          },
          {
            label: 'Providers',
            icon: HubIcon,
            to: '/ai/providers',
            hint: 'What the gateway can reach, and the keys it holds',
          },
          {
            label: 'Virtual keys',
            icon: VpnKeyIcon,
            to: '/ai/virtual-keys',
            hint: 'Which of your services may call it, and what each may reach',
          },
          {
            label: 'Budgets',
            icon: SpeedIcon,
            to: '/ai/budgets',
            hint: 'What each caller may spend, and how much of it is gone',
          },
          {
            // After Budgets, because it is the other half of the same
            // question: what a caller may spend, and what spends it.
            label: 'Model prices',
            icon: PriceChangeIcon,
            to: '/ai/model-prices',
            hint: 'What the gateway charges each call against, per million tokens',
          },
          {
            // Last in the group rather than alone under a Settings
            // heading: everything here is the gateway, and how this
            // console reaches it is the last of those things — not a
            // separate concern that needs its own section.
            //
            // Not "Gateway": the group is called that, and a nav with a
            // group and an item of the same name makes you read both to
            // find out which is which.
            label: 'Connection',
            icon: SettingsEthernetIcon,
            to: '/ai/connection',
            hint: 'How this console reaches the gateway',
          },
        ],
      },
      {
        label: 'Billing',
        items: [
          {
            label: 'Provider accounts',
            icon: PaidIcon,
            to: '/ai/accounts',
            hint: "What's left where you pay, without a login each",
          },
        ],
      },
    ],
    description:
      'What your lab asks of language models, and what answers: requests through the gateway, the providers behind it, and the models running on your own hardware.',
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
            label: 'Branding',
            icon: PaletteIcon,
            to: '/iam/branding',
            hint: 'What this console calls itself',
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
    // Last, and deliberately apart from the sections it describes: this
    // is the one place in the console that isn't a view onto the lab.
    id: 'docs',
    label: 'Documentation',
    icon: MenuBookIcon,
    prefix: '/docs',
    home: '/docs',
    items: [
      {
        label: 'All docs',
        icon: MenuBookIcon,
        to: '/docs',
        hint: 'Setup guides for the things this console talks to',
      },
    ],
    groups: [
      {
        label: 'Guides',
        items: docs.map((doc) => ({
          label: doc.title,
          icon: ArticleIcon,
          to: `/docs/${doc.slug}`,
          hint: doc.summary,
        })),
      },
    ],
    description: 'How to set up the things this console talks to.',
  },]

export function sectionFor(pathname: string): Section | undefined {
  return sections.find((s) => pathname.startsWith(s.prefix))
}
