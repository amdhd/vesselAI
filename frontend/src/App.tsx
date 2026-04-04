import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { FleetProvider } from '@/context/FleetContext'
import MainLayout from '@/components/layout/MainLayout'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import DashboardPage from '@/pages/DashboardPage'
import VoyagePage from '@/modules/voyage/VoyagePage'
import MaintenancePage from '@/modules/maintenance/MaintenancePage'
import CompliancePage from '@/modules/compliance/CompliancePage'
import PortsPage from '@/modules/ports/PortsPage'
import KnowledgePage from '@/modules/knowledge/KnowledgePage'
import SirePage from '@/modules/sire/SirePage'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-navy-900">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading VesselMind AI...</p>
        </div>
      </div>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <FleetProvider>
              <MainLayout>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/voyage" element={<VoyagePage />} />
                  <Route path="/maintenance" element={<MaintenancePage />} />
                  <Route path="/compliance" element={<CompliancePage />} />
                  <Route path="/ports" element={<PortsPage />} />
                  <Route path="/knowledge" element={<KnowledgePage />} />
                  <Route path="/sire" element={<SirePage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </MainLayout>
            </FleetProvider>
          </PrivateRoute>
        }
      />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
