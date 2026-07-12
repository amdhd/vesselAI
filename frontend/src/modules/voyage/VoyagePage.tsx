import { useState, Suspense, lazy } from 'react'
import { Navigation, Gauge, Clock, CloudSun, Bot } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import Tabs from '@/components/ui/Tabs'

const RouteOptimizer = lazy(() => import('./RouteOptimizer'))
const AgentPlanner = lazy(() => import('./AgentPlanner'))
const SpeedOptimizer = lazy(() => import('./SpeedOptimizer'))
const VoyageHistory = lazy(() => import('./VoyageHistory'))
const WeatherPanel = lazy(() => import('./WeatherPanel'))

const TABS = [
  { id: 'route', label: 'Route Optimizer', icon: Navigation },
  { id: 'agent', label: 'AI Agent', icon: Bot },
  { id: 'speed', label: 'Speed Optimizer', icon: Gauge },
  { id: 'history', label: 'Voyage History', icon: Clock },
  { id: 'weather', label: 'Weather', icon: CloudSun },
] as const

type TabId = (typeof TABS)[number]['id']

function TabLoadingState() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">Loading module...</p>
      </div>
    </div>
  )
}

export default function VoyagePage() {
  const { selectedVessel } = useFleet()
  const [activeTab, setActiveTab] = useState<TabId>('route')

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[23px] font-semibold text-[#f0f1f3] tracking-[-0.01em]">Voyage Optimizer</h1>
        <p className="text-[#767d88] text-[13px] mt-[5px]">
          {selectedVessel ? (
            <>AI-powered voyage planning for <span className="text-teal-400 font-medium">{selectedVessel.name}</span></>
          ) : (
            'Select a vessel from the top bar to begin'
          )}
        </p>
      </div>

      {/* Tabs */}
      <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {/* Tab content */}
      <Suspense fallback={<TabLoadingState />}>
        {activeTab === 'route' && <RouteOptimizer />}
        {activeTab === 'agent' && <AgentPlanner />}
        {activeTab === 'speed' && <SpeedOptimizer />}
        {activeTab === 'history' && <VoyageHistory />}
        {activeTab === 'weather' && <WeatherPanel />}
      </Suspense>
    </div>
  )
}
