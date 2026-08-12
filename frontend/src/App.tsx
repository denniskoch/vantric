import { Navigate, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import InstancesPage from './pages/InstancesPage'
import CreateInstancePage from './pages/CreateInstancePage'
import InstanceDetailPage from './pages/InstanceDetailPage'
import ImagesPage from './pages/ImagesPage'
import OverviewPage from './pages/OverviewPage'
import ServersPage from './pages/ServersPage'
import MachineTypesPage from './pages/MachineTypesPage'
import DisksPage from './pages/DisksPage'
import SnapshotsPage from './pages/SnapshotsPage'
import ContainersPage from './pages/ContainersPage'
import ContainerDetailPage from './pages/ContainerDetailPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/compute/instances" replace />} />
        <Route path="/compute/overview" element={<OverviewPage />} />
        <Route path="/compute/instances" element={<InstancesPage />} />
        <Route path="/compute/instances/create" element={<CreateInstancePage />} />
        <Route path="/compute/instances/:name" element={<InstanceDetailPage />} />
        <Route path="/compute/containers" element={<ContainersPage />} />
        <Route path="/compute/containers/:name" element={<ContainerDetailPage />} />
        <Route path="/compute/images" element={<ImagesPage />} />
        <Route path="/compute/disks" element={<DisksPage />} />
        <Route path="/compute/snapshots" element={<SnapshotsPage />} />
        <Route path="/compute/servers" element={<ServersPage />} />
        <Route path="/compute/settings/machine-types" element={<MachineTypesPage />} />
      </Route>
    </Routes>
  )
}
