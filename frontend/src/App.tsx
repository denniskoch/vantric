import { Navigate, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import InstancesPage from './pages/InstancesPage'
import CreateInstancePage from './pages/CreateInstancePage'
import InstanceDetailPage from './pages/InstanceDetailPage'
import InstanceSSHPage from './pages/InstanceSSHPage'
import SignInPage from './pages/SignInPage'
import IAMUsersPage from './pages/IAMUsersPage'
import IAMUserFormPage from './pages/IAMUserFormPage'
import IAMPasswordPage from './pages/IAMPasswordPage'
import IAMSignOnPage from './pages/IAMSignOnPage'
import MyAccountPage from './pages/MyAccountPage'
import MyPasswordPage from './pages/MyPasswordPage'
import MySSHKeyPage from './pages/MySSHKeyPage'
import VMTemplatesPage from './pages/VMTemplatesPage'
import BuildTemplatePage from './pages/BuildTemplatePage'
import CTTemplatesPage from './pages/CTTemplatesPage'
import OverviewPage from './pages/OverviewPage'
import CloudOverviewPage from './pages/CloudOverviewPage'
import EditDescriptionPage, {
  instanceDescription,
  templateDescription,
} from './pages/EditDescriptionPage'
import SectionLandingPage from './pages/SectionLandingPage'
import DNSZonesPage from './pages/DNSZonesPage'
import DNSZoneDetailPage from './pages/DNSZoneDetailPage'
import RecordSetPage from './pages/RecordSetPage'
import CreateZonePage from './pages/CreateZonePage'
import DatabaseInstancesPage from './pages/DatabaseInstancesPage'
import DatabaseInstanceDetailPage from './pages/DatabaseInstanceDetailPage'
import AddDatabaseInstancePage from './pages/AddDatabaseInstancePage'
import DatabasesPage from './pages/DatabasesPage'
import DatabaseDetailPage from './pages/DatabaseDetailPage'
import DatabaseAccessPage from './pages/DatabaseAccessPage'
import {
  NetworkNetworksPage,
  NetworkClientsPage,
  NetworkDevicesPage,
  NetworkInternetPage,
  NetworkVPNPage,
  NetworkWiFiPage,
  NetworkSitesPage,
} from './pages/NetworkPages'
import NetworkControllersPage from './pages/NetworkControllersPage'
import NetworkControllerFormPage from './pages/NetworkControllerFormPage'
import {
  CreateDatabasePage,
  CreateDatabaseUserPage,
  DatabaseUserPasswordPage,
} from './pages/DatabaseFormPages'
import HypervisorFormPage from './pages/HypervisorFormPage'
import DNSProviderFormPage from './pages/DNSProviderFormPage'
import IdentityUsersPage from './pages/IdentityUsersPage'
import IdentityUserEditPage from './pages/IdentityUserEditPage'
import IdentityUserCreatePage from './pages/IdentityUserCreatePage'
import IdentityGroupsPage from './pages/IdentityGroupsPage'
import IdentityGroupDetailPage from './pages/IdentityGroupDetailPage'
import IdentityApplicationsPage from './pages/IdentityApplicationsPage'
import IdentityEventsPage from './pages/IdentityEventsPage'
import IdentityProvidersPage from './pages/IdentityProvidersPage'
import AddIdentityProviderPage from './pages/AddIdentityProviderPage'
import DNSProvidersPage from './pages/DNSProvidersPage'
import ServersPage from './pages/ServersPage'
import InventoryProvidersPage from './pages/InventoryProvidersPage'
import DevicesHostsPage from './pages/DevicesHostsPage'
import DevicesHostPage from './pages/DevicesHostPage'
import DevicesVulnerabilitiesPage from './pages/DevicesVulnerabilitiesPage'
import InventoryProviderFormPage from './pages/InventoryProviderFormPage'
import DisksPage from './pages/DisksPage'
import SnapshotsPage from './pages/SnapshotsPage'
import BackupsPage from './pages/BackupsPage'
import ContainersPage from './pages/ContainersPage'
import ContainerDetailPage from './pages/ContainerDetailPage'
import ISOsPage from './pages/ISOsPage'
import CloudImagesPage from './pages/CloudImagesPage'
import AddMediaPage, { isoKind, cloudImageKind } from './pages/AddMediaPage'
import DatastoresPage from './pages/DatastoresPage'

export default function App() {
  return (
    <Routes>
      {/* Outside the shell: it's what you see when you have no session. */}
      <Route path="/signin" element={<SignInPage />} />
      {/* Opened in its own window, so no shell around it. */}
      <Route path="/compute/instances/:name/ssh" element={<InstanceSSHPage />} />
      <Route element={<Shell />}>
        {/* The console opens on the overview, not on a resource list. */}
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<CloudOverviewPage />} />
        <Route path="/compute/overview" element={<OverviewPage />} />
        <Route path="/devices/overview" element={<SectionLandingPage />} />
        <Route path="/devices/hosts" element={<DevicesHostsPage />} />
        <Route path="/devices/hosts/:id" element={<DevicesHostPage />} />
        <Route path="/devices/vulnerabilities" element={<DevicesVulnerabilitiesPage />} />
        <Route path="/devices/settings/inventory" element={<InventoryProvidersPage />} />
        <Route path="/devices/settings/inventory/add" element={<InventoryProviderFormPage />} />
        <Route
          path="/devices/settings/inventory/:id/edit"
          element={<InventoryProviderFormPage />}
        />
        <Route
          path="/compute/instances/:name/description"
          element={<EditDescriptionPage target={instanceDescription} />}
        />
        <Route
          path="/compute/vm-templates/:serverId/:id/description"
          element={<EditDescriptionPage target={templateDescription} />}
        />
        {/* Every section has an overview, on the shared landing template. */}
        <Route path="/storage/overview" element={<SectionLandingPage />} />
        <Route path="/network/overview" element={<SectionLandingPage />} />
        <Route path="/network/sites" element={<NetworkSitesPage />} />
        <Route path="/network/wifi" element={<NetworkWiFiPage />} />
        <Route path="/network/networks" element={<NetworkNetworksPage />} />
        <Route path="/network/internet" element={<NetworkInternetPage />} />
        <Route path="/network/vpn" element={<NetworkVPNPage />} />
        <Route path="/network/clients" element={<NetworkClientsPage />} />
        <Route path="/network/devices" element={<NetworkDevicesPage />} />
        <Route path="/network/controllers" element={<NetworkControllersPage />} />
        <Route path="/network/controllers/add" element={<NetworkControllerFormPage />} />
        <Route path="/network/controllers/:id/edit" element={<NetworkControllerFormPage />} />
        <Route path="/databases/overview" element={<SectionLandingPage />} />
        <Route path="/databases/instances" element={<DatabaseInstancesPage />} />
        <Route path="/databases/instances/add" element={<AddDatabaseInstancePage />} />
        <Route path="/databases/instances/:id" element={<DatabaseInstanceDetailPage />} />
        <Route path="/databases/instances/:id/edit" element={<AddDatabaseInstancePage />} />
        <Route path="/databases/databases" element={<DatabasesPage />} />
        <Route
          path="/databases/instances/:id/databases/:name"
          element={<DatabaseDetailPage />}
        />
        <Route
          path="/databases/instances/:id/databases/:name/access"
          element={<DatabaseAccessPage />}
        />
        <Route
          path="/databases/instances/:id/databases/create"
          element={<CreateDatabasePage />}
        />
        <Route path="/databases/instances/:id/users/create" element={<CreateDatabaseUserPage />} />
        <Route
          path="/databases/instances/:id/users/:name/password"
          element={<DatabaseUserPasswordPage />}
        />
        <Route path="/docker/overview" element={<SectionLandingPage />} />
        <Route path="/iam/overview" element={<SectionLandingPage />} />
        <Route path="/iam/account" element={<MyAccountPage />} />
        <Route path="/iam/account/password" element={<MyPasswordPage />} />
        <Route path="/iam/account/ssh-key" element={<MySSHKeyPage />} />
        <Route path="/iam/users" element={<IAMUsersPage />} />
        <Route path="/iam/sign-on" element={<IAMSignOnPage />} />
        <Route path="/iam/users/create" element={<IAMUserFormPage />} />
        <Route path="/iam/users/:id/edit" element={<IAMUserFormPage />} />
        <Route path="/iam/users/:id/password" element={<IAMPasswordPage />} />
        <Route path="/identity/overview" element={<SectionLandingPage />} />
        <Route path="/identity/users" element={<IdentityUsersPage />} />
        <Route path="/identity/users/create" element={<IdentityUserCreatePage />} />
        <Route path="/identity/users/:id/edit" element={<IdentityUserEditPage />} />
        <Route path="/identity/groups" element={<IdentityGroupsPage />} />
        <Route path="/identity/groups/:id" element={<IdentityGroupDetailPage />} />
        <Route path="/identity/applications" element={<IdentityApplicationsPage />} />
        <Route path="/identity/events" element={<IdentityEventsPage />} />
        <Route path="/identity/providers" element={<IdentityProvidersPage />} />
        <Route path="/identity/providers/add" element={<AddIdentityProviderPage />} />
        <Route path="/identity/providers/:id/edit" element={<AddIdentityProviderPage />} />
        <Route path="/dns/overview" element={<SectionLandingPage />} />
        <Route path="/dns/zones" element={<DNSZonesPage />} />
        <Route path="/dns/zones/create" element={<CreateZonePage />} />
        <Route path="/dns/zones/:providerId/:zoneId" element={<DNSZoneDetailPage />} />
        <Route path="/dns/zones/:providerId/:zoneId/records/new" element={<RecordSetPage />} />
        <Route path="/dns/zones/:providerId/:zoneId/records/edit" element={<RecordSetPage />} />
        <Route path="/dns/providers" element={<DNSProvidersPage />} />
        <Route path="/dns/providers/add" element={<DNSProviderFormPage />} />
        <Route path="/dns/providers/:id/edit" element={<DNSProviderFormPage />} />
        <Route path="/storage" element={<Navigate to="/storage/overview" replace />} />
        <Route path="/network" element={<Navigate to="/network/overview" replace />} />
        <Route path="/databases" element={<Navigate to="/databases/overview" replace />} />
        <Route path="/docker" element={<Navigate to="/docker/overview" replace />} />
        <Route path="/iam" element={<Navigate to="/iam/overview" replace />} />
        <Route path="/identity" element={<Navigate to="/identity/overview" replace />} />
        <Route path="/dns" element={<Navigate to="/dns/overview" replace />} />
        <Route path="/compute/instances" element={<InstancesPage />} />
        <Route path="/compute/instances/create" element={<CreateInstancePage />} />
        <Route path="/compute/instances/:name" element={<InstanceDetailPage />} />
        <Route path="/compute/containers" element={<ContainersPage />} />
        <Route path="/compute/containers/:name" element={<ContainerDetailPage />} />
        <Route path="/compute/vm-templates" element={<VMTemplatesPage />} />
        <Route path="/compute/vm-templates/build" element={<BuildTemplatePage />} />
        <Route path="/compute/ct-templates" element={<CTTemplatesPage />} />
        {/* legacy path */}
        <Route path="/compute/images" element={<Navigate to="/compute/vm-templates" replace />} />
        <Route path="/compute/disks" element={<DisksPage />} />
        <Route path="/compute/snapshots" element={<SnapshotsPage />} />
        <Route path="/compute/backups" element={<BackupsPage />} />
        <Route path="/compute/isos" element={<ISOsPage />} />
        <Route path="/compute/isos/add" element={<AddMediaPage kind={isoKind} />} />
        <Route path="/compute/cloud-images" element={<CloudImagesPage />} />
        <Route
          path="/compute/cloud-images/add"
          element={<AddMediaPage kind={cloudImageKind} />}
        />
        <Route path="/compute/datastores" element={<DatastoresPage />} />
        <Route path="/compute/settings/hypervisors" element={<ServersPage />} />
        <Route path="/compute/servers" element={<Navigate to="/compute/settings/hypervisors" replace />} />
        <Route path="/compute/settings/hypervisors/add" element={<HypervisorFormPage />} />
        <Route path="/compute/settings/hypervisors/:id/edit" element={<HypervisorFormPage />} />
      </Route>
    </Routes>
  )
}
