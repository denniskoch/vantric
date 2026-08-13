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
import ServersPage from './pages/ServersPage'
import MachineTypesPage from './pages/MachineTypesPage'
import DisksPage from './pages/DisksPage'
import SnapshotsPage from './pages/SnapshotsPage'
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
        <Route path="/databases/overview" element={<SectionLandingPage />} />
        <Route path="/docker/overview" element={<SectionLandingPage />} />
        <Route path="/dns/overview" element={<SectionLandingPage />} />
        <Route path="/storage" element={<Navigate to="/storage/overview" replace />} />
        <Route path="/network" element={<Navigate to="/network/overview" replace />} />
        <Route path="/databases" element={<Navigate to="/databases/overview" replace />} />
        <Route path="/docker" element={<Navigate to="/docker/overview" replace />} />
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
        <Route path="/compute/isos" element={<ISOsPage />} />
        <Route path="/compute/isos/add" element={<AddMediaPage kind={isoKind} />} />
        <Route path="/compute/cloud-images" element={<CloudImagesPage />} />
        <Route
          path="/compute/cloud-images/add"
          element={<AddMediaPage kind={cloudImageKind} />}
        />
        <Route path="/compute/datastores" element={<DatastoresPage />} />
        <Route path="/compute/servers" element={<ServersPage />} />
        <Route path="/compute/settings/machine-types" element={<MachineTypesPage />} />
      </Route>
    </Routes>
  )
}
