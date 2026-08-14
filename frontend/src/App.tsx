import { Navigate, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import InstancesPage from './pages/InstancesPage'
import CreateInstancePage from './pages/CreateInstancePage'
import InstanceDetailPage from './pages/InstanceDetailPage'
import VMTemplatesPage from './pages/VMTemplatesPage'
import BuildTemplatePage from './pages/BuildTemplatePage'
import CTTemplatesPage from './pages/CTTemplatesPage'
import OverviewPage from './pages/OverviewPage'
import SectionLandingPage from './pages/SectionLandingPage'
import DNSZonesPage from './pages/DNSZonesPage'
import DNSZoneDetailPage from './pages/DNSZoneDetailPage'
import RecordSetPage from './pages/RecordSetPage'
import CreateZonePage from './pages/CreateZonePage'
import DatabaseInstancesPage from './pages/DatabaseInstancesPage'
import DatabaseInstanceDetailPage from './pages/DatabaseInstanceDetailPage'
import AddDatabaseInstancePage from './pages/AddDatabaseInstancePage'
import DatabasesPage from './pages/DatabasesPage'
import {
  NetworkNetworksPage,
  NetworkClientsPage,
  NetworkDevicesPage,
} from './pages/NetworkPages'
import NetworkControllersPage from './pages/NetworkControllersPage'
import NetworkControllerFormPage from './pages/NetworkControllerFormPage'
import {
  CreateDatabasePage,
  CreateDatabaseUserPage,
  DatabaseUserPasswordPage,
} from './pages/DatabaseFormPages'
import HypervisorFormPage from './pages/HypervisorFormPage'
import MachineTypeFormPage from './pages/MachineTypeFormPage'
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
import MachineTypesPage from './pages/MachineTypesPage'
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
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/compute/instances" replace />} />
        <Route path="/compute/overview" element={<OverviewPage />} />
        {/* Every section has an overview, on the shared landing template. */}
        <Route path="/storage/overview" element={<SectionLandingPage />} />
        <Route path="/network/overview" element={<SectionLandingPage />} />
        <Route path="/network/networks" element={<NetworkNetworksPage />} />
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
        <Route path="/compute/settings/machine-types" element={<MachineTypesPage />} />
        <Route path="/compute/settings/machine-types/create" element={<MachineTypeFormPage />} />
      </Route>
    </Routes>
  )
}
