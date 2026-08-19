import { Navigate, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import RequireRole from './components/RequireRole'
import InstancesPage from './pages/InstancesPage'
import CreateInstancePage from './pages/CreateInstancePage'
import InstanceDetailPage from './pages/InstanceDetailPage'
import InstanceSSHPage from './pages/InstanceSSHPage'
import SignInPage from './pages/SignInPage'
import IAMUsersPage from './pages/IAMUsersPage'
import IAMUserFormPage from './pages/IAMUserFormPage'
import IAMPasswordPage from './pages/IAMPasswordPage'
import IAMSignOnPage from './pages/IAMSignOnPage'
import IAMActivityPage from './pages/IAMActivityPage'
import MyAccountPage from './pages/MyAccountPage'
import MyPasswordPage from './pages/MyPasswordPage'
import MySSHKeyPage from './pages/MySSHKeyPage'
import VMTemplatesPage from './pages/VMTemplatesPage'
import BuildTemplatePage from './pages/BuildTemplatePage'
import CTTemplatesPage from './pages/CTTemplatesPage'
import OverviewPage from './pages/OverviewPage'
import CloudOverviewPage from './pages/CloudOverviewPage'
import RenameInstancePage from './pages/RenameInstancePage'
import EditDescriptionPage, {
  instanceDescription,
  templateDescription,
} from './pages/EditDescriptionPage'
import SectionLandingPage from './pages/SectionLandingPage'
import DNSZonesPage from './pages/DNSZonesPage'
import DNSZoneDetailPage from './pages/DNSZoneDetailPage'
import RecordSetPage from './pages/RecordSetPage'
import ZoneSOAPage from './pages/ZoneSOAPage'
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
} from './pages/NetworkPages'
import NetworkControllersPage from './pages/NetworkControllersPage'
import NetworkSubnetsPage from './pages/NetworkSubnetsPage'
import NetworkSubnetFormPage from './pages/NetworkSubnetFormPage'
import NetworkSubnetDetailPage from './pages/NetworkSubnetDetailPage'
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
import HypervisorsPage from './pages/HypervisorsPage'
import InventoryProvidersPage from './pages/InventoryProvidersPage'
import {
  DevicesPhysicalHostsPage,
  DevicesVirtualHostsPage,
} from './pages/DevicesHostsPage'
import DevicesHostPage from './pages/DevicesHostPage'
import SecurityVulnerabilitiesPage from './pages/SecurityVulnerabilitiesPage'
import DevicesInstallersPage from './pages/DevicesInstallersPage'
import SecurityVulnerabilityPage from './pages/SecurityVulnerabilityPage'
import SecurityVulnerabilityDataPage from './pages/SecurityVulnerabilityDataPage'
import InventoryProviderFormPage from './pages/InventoryProviderFormPage'
import DisksPage from './pages/DisksPage'
import SnapshotsPage from './pages/SnapshotsPage'
import BackupsPage from './pages/BackupsPage'
import ContainersPage from './pages/ContainersPage'
import ContainerDetailPage from './pages/ContainerDetailPage'
import CreateContainerPage from './pages/CreateContainerPage'
import ISOsPage from './pages/ISOsPage'
import CloudImagesPage from './pages/CloudImagesPage'
import AddMediaPage, { isoKind, cloudImageKind } from './pages/AddMediaPage'
import DatastoresPage from './pages/DatastoresPage'
import BucketsPage from './pages/BucketsPage'
import BucketDetailPage from './pages/BucketDetailPage'
import CreateBucketPage from './pages/CreateBucketPage'
import BucketQuotaPage from './pages/BucketQuotaPage'
import BucketPublicPage from './pages/BucketPublicPage'
import StorageKeysPage from './pages/StorageKeysPage'
import CreateStorageKeyPage from './pages/CreateStorageKeyPage'
import StorageKeyPage from './pages/StorageKeyPage'
import StorageKeySecretPage from './pages/StorageKeySecretPage'
import StorageInstancesPage from './pages/StorageInstancesPage'
import StorageInstanceFormPage from './pages/StorageInstanceFormPage'
import NodesPage from './pages/NodesPage'
import NodeDetailPage from './pages/NodeDetailPage'

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
        <Route path="/security/overview" element={<SectionLandingPage />} />
        <Route path="/compute/overview" element={<OverviewPage />} />
        <Route path="/devices/overview" element={<SectionLandingPage />} />
        <Route path="/devices/physical-hosts" element={<DevicesPhysicalHostsPage />} />
        <Route path="/devices/virtual-hosts" element={<DevicesVirtualHostsPage />} />
        {/* The list was one page before the split; keep the old path working. */}
        <Route path="/devices/hosts" element={<Navigate to="/devices/virtual-hosts" replace />} />
        <Route path="/devices/hosts/:id" element={<DevicesHostPage />} />
        <Route path="/security/vulnerabilities" element={<SecurityVulnerabilitiesPage />} />
        <Route path="/security/vulnerabilities/:cve" element={<SecurityVulnerabilityPage />} />
        <Route path="/devices/installers" element={<DevicesInstallersPage />} />
        <Route path="/security/settings/vulnerability-data" element={<RequireRole admin><SecurityVulnerabilityDataPage /></RequireRole>} />
        <Route path="/devices/settings/inventory" element={<RequireRole admin><InventoryProvidersPage /></RequireRole>} />
        <Route path="/devices/settings/inventory/add" element={<RequireRole admin><InventoryProviderFormPage /></RequireRole>} />
        <Route
          path="/devices/settings/inventory/:id/edit"
          element={<RequireRole admin><InventoryProviderFormPage /></RequireRole>}
        />
        <Route
          path="/compute/instances/:name/rename"
          element={
            <RequireRole>
              <RenameInstancePage />
            </RequireRole>
          }
        />
        <Route
          path="/compute/instances/:name/description"
          element={
            <RequireRole>
              <EditDescriptionPage target={instanceDescription} />
            </RequireRole>
          }
        />
        <Route
          path="/compute/vm-templates/:hypervisorId/:id/description"
          element={
            <RequireRole>
              <EditDescriptionPage target={templateDescription} />
            </RequireRole>
          }
        />
        {/* Every section has an overview, on the shared landing template. */}
        <Route path="/storage/overview" element={<SectionLandingPage />} />
        <Route path="/storage/buckets" element={<BucketsPage />} />
        <Route path="/storage/buckets/create" element={<RequireRole><CreateBucketPage /></RequireRole>} />
        <Route path="/storage/buckets/:provider/:bucket" element={<BucketDetailPage />} />
        <Route path="/storage/buckets/:provider/:bucket/quota" element={<RequireRole><BucketQuotaPage /></RequireRole>} />
        <Route path="/storage/buckets/:provider/:bucket/public" element={<RequireRole><BucketPublicPage /></RequireRole>} />
        <Route path="/storage/keys" element={<StorageKeysPage />} />
        <Route path="/storage/keys/create" element={<RequireRole><CreateStorageKeyPage /></RequireRole>} />
        <Route path="/storage/keys/:providerId/:accessKey" element={<RequireRole><StorageKeyPage /></RequireRole>} />
        <Route path="/storage/keys/:providerId/:accessKey/secret" element={<RequireRole><StorageKeySecretPage /></RequireRole>} />
        <Route path="/storage/instances" element={<RequireRole admin><StorageInstancesPage /></RequireRole>} />
        <Route path="/storage/instances/add" element={<RequireRole admin><StorageInstanceFormPage /></RequireRole>} />
        <Route path="/storage/instances/:id/edit" element={<RequireRole admin><StorageInstanceFormPage /></RequireRole>} />
        <Route path="/network/overview" element={<SectionLandingPage />} />
        <Route path="/network/networks" element={<NetworkNetworksPage />} />
        <Route path="/network/clients" element={<NetworkClientsPage />} />
        <Route path="/network/subnets" element={<NetworkSubnetsPage />} />
        <Route path="/network/subnets/create" element={<RequireRole><NetworkSubnetFormPage /></RequireRole>} />
        <Route path="/network/subnets/:id" element={<NetworkSubnetDetailPage />} />
        <Route path="/network/subnets/:id/edit" element={<RequireRole><NetworkSubnetFormPage /></RequireRole>} />
        <Route path="/network/controllers" element={<RequireRole admin><NetworkControllersPage /></RequireRole>} />
        <Route path="/network/controllers/add" element={<RequireRole admin><NetworkControllerFormPage /></RequireRole>} />
        <Route path="/network/controllers/:id/edit" element={<RequireRole admin><NetworkControllerFormPage /></RequireRole>} />
        <Route path="/databases/overview" element={<SectionLandingPage />} />
        <Route path="/databases/instances" element={<DatabaseInstancesPage />} />
        <Route path="/databases/instances/add" element={<RequireRole admin><AddDatabaseInstancePage /></RequireRole>} />
        <Route path="/databases/instances/:id" element={<DatabaseInstanceDetailPage />} />
        <Route path="/databases/instances/:id/edit" element={<RequireRole admin><AddDatabaseInstancePage /></RequireRole>} />
        <Route path="/databases/databases" element={<DatabasesPage />} />
        <Route
          path="/databases/instances/:id/databases/:name"
          element={<DatabaseDetailPage />}
        />
        <Route
          path="/databases/instances/:id/databases/:name/access"
          element={<RequireRole><DatabaseAccessPage /></RequireRole>}
        />
        <Route
          path="/databases/instances/:id/databases/create"
          element={<RequireRole><CreateDatabasePage /></RequireRole>}
        />
        <Route path="/databases/instances/:id/users/create" element={<RequireRole><CreateDatabaseUserPage /></RequireRole>} />
        <Route
          path="/databases/instances/:id/users/:name/password"
          element={<RequireRole><DatabaseUserPasswordPage /></RequireRole>}
        />
        <Route path="/docker/overview" element={<SectionLandingPage />} />
        <Route path="/iam/overview" element={<SectionLandingPage />} />
        <Route path="/iam/account" element={<MyAccountPage />} />
        <Route path="/iam/account/password" element={<MyPasswordPage />} />
        <Route path="/iam/account/ssh-key" element={<MySSHKeyPage />} />
        <Route path="/iam/users" element={<RequireRole admin><IAMUsersPage /></RequireRole>} />
        <Route path="/iam/sign-on" element={<RequireRole admin><IAMSignOnPage /></RequireRole>} />
        <Route path="/iam/activity" element={<IAMActivityPage />} />
        <Route path="/iam/users/create" element={<RequireRole admin><IAMUserFormPage /></RequireRole>} />
        <Route path="/iam/users/:id/edit" element={<RequireRole admin><IAMUserFormPage /></RequireRole>} />
        <Route path="/iam/users/:id/password" element={<RequireRole admin><IAMPasswordPage /></RequireRole>} />
        <Route path="/identity/overview" element={<SectionLandingPage />} />
        <Route path="/identity/users" element={<IdentityUsersPage />} />
        <Route path="/identity/users/create" element={<RequireRole><IdentityUserCreatePage /></RequireRole>} />
        <Route path="/identity/users/:id/edit" element={<RequireRole><IdentityUserEditPage /></RequireRole>} />
        <Route path="/identity/groups" element={<IdentityGroupsPage />} />
        <Route path="/identity/groups/:id" element={<IdentityGroupDetailPage />} />
        <Route path="/identity/applications" element={<IdentityApplicationsPage />} />
        <Route path="/identity/events" element={<IdentityEventsPage />} />
        <Route path="/identity/providers" element={<RequireRole admin><IdentityProvidersPage /></RequireRole>} />
        <Route path="/identity/providers/add" element={<RequireRole admin><AddIdentityProviderPage /></RequireRole>} />
        <Route path="/identity/providers/:id/edit" element={<RequireRole admin><AddIdentityProviderPage /></RequireRole>} />
        <Route path="/dns/overview" element={<SectionLandingPage />} />
        <Route path="/dns/zones" element={<DNSZonesPage />} />
        <Route path="/dns/zones/create" element={<RequireRole><CreateZonePage /></RequireRole>} />
        <Route path="/dns/zones/:providerId/:zoneId" element={<DNSZoneDetailPage />} />
        <Route path="/dns/zones/:providerId/:zoneId/soa" element={<RequireRole><ZoneSOAPage /></RequireRole>} />
        <Route path="/dns/zones/:providerId/:zoneId/records/new" element={<RequireRole><RecordSetPage /></RequireRole>} />
        <Route path="/dns/zones/:providerId/:zoneId/records/edit" element={<RequireRole><RecordSetPage /></RequireRole>} />
        <Route path="/dns/providers" element={<RequireRole admin><DNSProvidersPage /></RequireRole>} />
        <Route path="/dns/providers/add" element={<RequireRole admin><DNSProviderFormPage /></RequireRole>} />
        <Route path="/dns/providers/:id/edit" element={<RequireRole admin><DNSProviderFormPage /></RequireRole>} />
        <Route path="/storage" element={<Navigate to="/storage/overview" replace />} />
        <Route path="/network" element={<Navigate to="/network/overview" replace />} />
        <Route path="/databases" element={<Navigate to="/databases/overview" replace />} />
        <Route path="/docker" element={<Navigate to="/docker/overview" replace />} />
        <Route path="/iam" element={<Navigate to="/iam/overview" replace />} />
        <Route path="/identity" element={<Navigate to="/identity/overview" replace />} />
        <Route path="/dns" element={<Navigate to="/dns/overview" replace />} />
        <Route path="/compute/instances" element={<InstancesPage />} />
        <Route path="/compute/instances/create" element={<RequireRole><CreateInstancePage /></RequireRole>} />
        <Route path="/compute/instances/:name" element={<InstanceDetailPage />} />
        <Route path="/compute/containers" element={<ContainersPage />} />
        <Route path="/compute/containers/create" element={<RequireRole><CreateContainerPage /></RequireRole>} />
        <Route path="/compute/containers/:name" element={<ContainerDetailPage />} />
        <Route path="/compute/vm-templates" element={<VMTemplatesPage />} />
        <Route path="/compute/vm-templates/build" element={<RequireRole><BuildTemplatePage /></RequireRole>} />
        <Route path="/compute/ct-templates" element={<CTTemplatesPage />} />
        {/* legacy path */}
        <Route path="/compute/images" element={<Navigate to="/compute/vm-templates" replace />} />
        <Route path="/compute/disks" element={<DisksPage />} />
        <Route path="/compute/snapshots" element={<SnapshotsPage />} />
        <Route path="/compute/backups" element={<BackupsPage />} />
        <Route path="/compute/isos" element={<ISOsPage />} />
        <Route
          path="/compute/isos/add"
          element={
            <RequireRole>
              <AddMediaPage kind={isoKind} />
            </RequireRole>
          }
        />
        <Route path="/compute/cloud-images" element={<CloudImagesPage />} />
        <Route
          path="/compute/cloud-images/add"
          element={
            <RequireRole>
              <AddMediaPage kind={cloudImageKind} />
            </RequireRole>
          }
        />
        <Route path="/compute/datastores" element={<DatastoresPage />} />
        <Route path="/compute/nodes" element={<NodesPage />} />
        {/* A node name is unique only within its server, so both
            address one host. */}
        {/* A node name is unique only within its hypervisor, so both
            address one host. The param names must match what
            NodeDetailPage destructures — useParams fails silently. */}
        <Route path="/compute/nodes/:hypervisor/:node" element={<NodeDetailPage />} />
        <Route path="/compute/hypervisors" element={<RequireRole admin><HypervisorsPage /></RequireRole>} />
        <Route path="/compute/hypervisors/add" element={<RequireRole admin><HypervisorFormPage /></RequireRole>} />
        <Route path="/compute/hypervisors/:id/edit" element={<RequireRole admin><HypervisorFormPage /></RequireRole>} />
        {/* The old address, from when this lived under Settings. */}
        <Route path="/compute/settings/hypervisors" element={<Navigate to="/compute/hypervisors" replace />} />
      </Route>
    </Routes>
  )
}
