import { useState } from 'react'
import { Shield, BarChart2, FileText, MessageSquare, Grid } from 'lucide-react'
import CIITracker from './CIITracker'
import ETSTracker from './ETSTracker'
import EmissionsLog from './EmissionsLog'
import ComplianceChat from './ComplianceChat'
import FleetMatrix from './FleetMatrix'

type Tab = 'cii' | 'ets' | 'emissions' | 'chat' | 'matrix'

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'cii', label: 'CII Tracker', icon: <BarChart2 className="w-4 h-4" /> },
  { id: 'ets', label: 'EU ETS', icon: <Shield className="w-4 h-4" /> },
  { id: 'emissions', label: 'Emissions Log', icon: <FileText className="w-4 h-4" /> },
  { id: 'chat', label: 'Compliance Chat', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'matrix', label: 'Fleet Matrix', icon: <Grid className="w-4 h-4" /> },
]

export default function CompliancePage() {
  const [activeTab, setActiveTab] = useState<Tab>('cii')

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Compliance</h1>
        <p className="text-gray-400 text-sm mt-1">CII, EU ETS, Emissions monitoring and MARPOL compliance</p>
      </div>

      <div className="flex gap-1 bg-navy-800 p-1 rounded-xl border border-navy-700 mb-6 flex-shrink-0 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-white hover:bg-navy-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'cii' && <CIITracker />}
        {activeTab === 'ets' && <ETSTracker />}
        {activeTab === 'emissions' && <EmissionsLog />}
        {activeTab === 'chat' && <ComplianceChat />}
        {activeTab === 'matrix' && <FleetMatrix />}
      </div>
    </div>
  )
}
