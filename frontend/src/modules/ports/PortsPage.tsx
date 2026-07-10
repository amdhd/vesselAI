import { useState } from 'react'
import { Map, BarChart2, Clock, MessageSquare } from 'lucide-react'
import Tabs from '@/components/ui/Tabs'
import LiveFleetMap from './LiveFleetMap'
import PortCongestion from './PortCongestion'
import DemurrageCalculator from './DemurrageCalculator'
import AgentHub from './AgentHub'

type Tab = 'map' | 'congestion' | 'demurrage' | 'agents'

const TABS = [
  { id: 'map' as Tab, label: 'Live Fleet Map', icon: Map },
  { id: 'congestion' as Tab, label: 'Port Congestion', icon: BarChart2 },
  { id: 'demurrage' as Tab, label: 'Demurrage', icon: Clock },
  { id: 'agents' as Tab, label: 'Agent Hub', icon: MessageSquare },
]

export default function PortsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('map')

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6">
        <h1 className="text-[23px] font-semibold text-[#f0f1f3] tracking-[-0.01em]">Ports & Operations</h1>
        <p className="text-[#767d88] text-[13px] mt-[5px]">Fleet tracking, port intelligence, and agent communication</p>
      </div>

      <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} className="mb-6 flex-shrink-0 overflow-x-auto" />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'map' && <LiveFleetMap />}
        {activeTab === 'congestion' && <PortCongestion />}
        {activeTab === 'demurrage' && <DemurrageCalculator />}
        {activeTab === 'agents' && <AgentHub />}
      </div>
    </div>
  )
}
