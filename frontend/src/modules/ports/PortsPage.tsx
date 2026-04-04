import { useState } from 'react'
import { Map, BarChart2, Clock, MessageSquare } from 'lucide-react'
import LiveFleetMap from './LiveFleetMap'
import PortCongestion from './PortCongestion'
import DemurrageCalculator from './DemurrageCalculator'
import AgentHub from './AgentHub'

type Tab = 'map' | 'congestion' | 'demurrage' | 'agents'

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'map', label: 'Live Fleet Map', icon: <Map className="w-4 h-4" /> },
  { id: 'congestion', label: 'Port Congestion', icon: <BarChart2 className="w-4 h-4" /> },
  { id: 'demurrage', label: 'Demurrage', icon: <Clock className="w-4 h-4" /> },
  { id: 'agents', label: 'Agent Hub', icon: <MessageSquare className="w-4 h-4" /> },
]

export default function PortsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('map')

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Ports & Operations</h1>
        <p className="text-gray-400 text-sm mt-1">Fleet tracking, port intelligence, and agent communication</p>
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
        {activeTab === 'map' && <LiveFleetMap />}
        {activeTab === 'congestion' && <PortCongestion />}
        {activeTab === 'demurrage' && <DemurrageCalculator />}
        {activeTab === 'agents' && <AgentHub />}
      </div>
    </div>
  )
}
