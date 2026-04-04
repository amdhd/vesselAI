import { useState, Suspense, lazy } from 'react'
import { Cpu, ClipboardList, Calendar } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { cn } from '@/lib/utils'

const EquipmentGrid = lazy(() => import('./EquipmentGrid'))
const WorkOrderSystem = lazy(() => import('./WorkOrderSystem'))

const TABS = [
  { id: 'equipment', label: 'Equipment Health', icon: Cpu },
  { id: 'workorders', label: 'Work Orders', icon: ClipboardList },
  { id: 'calendar', label: 'Maintenance Calendar', icon: Calendar },
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

function CalendarPlaceholder() {
  return (
    <div className="card flex flex-col items-center justify-center py-16 text-center">
      <Calendar className="w-12 h-12 text-gray-600 mb-4" />
      <h3 className="text-white font-semibold text-lg">Maintenance Calendar</h3>
      <p className="text-gray-400 text-sm mt-2 max-w-sm">
        Interactive maintenance scheduling calendar coming soon. View planned work orders by date.
      </p>
      <div className="mt-6 px-4 py-2 bg-navy-700 border border-navy-600 rounded-lg text-gray-500 text-xs">
        Calendar view — Planned feature
      </div>
    </div>
  )
}

export default function MaintenancePage() {
  const { selectedVessel } = useFleet()
  const [activeTab, setActiveTab] = useState<TabId>('equipment')

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Maintenance AI</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {selectedVessel ? (
            <>Equipment health monitoring for <span className="text-teal-400 font-medium">{selectedVessel.name}</span></>
          ) : (
            'Select a vessel to view equipment health'
          )}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-navy-800 border border-navy-700 rounded-xl w-fit">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                activeTab === tab.id
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white hover:bg-navy-700'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <Suspense fallback={<TabLoadingState />}>
        {activeTab === 'equipment' && <EquipmentGrid />}
        {activeTab === 'workorders' && <WorkOrderSystem />}
        {activeTab === 'calendar' && <CalendarPlaceholder />}
      </Suspense>
    </div>
  )
}
