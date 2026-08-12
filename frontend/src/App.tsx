import { Navigate, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import InstancesPage from './pages/InstancesPage'
import CreateInstancePage from './pages/CreateInstancePage'
import InstanceDetailPage from './pages/InstanceDetailPage'
import ImagesPage from './pages/ImagesPage'
import OverviewPage from './pages/OverviewPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/compute/instances" replace />} />
        <Route path="/compute/overview" element={<OverviewPage />} />
        <Route path="/compute/instances" element={<InstancesPage />} />
        <Route path="/compute/instances/create" element={<CreateInstancePage />} />
        <Route path="/compute/instances/:name" element={<InstanceDetailPage />} />
        <Route path="/compute/images" element={<ImagesPage />} />
      </Route>
    </Routes>
  )
}
