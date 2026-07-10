import { useState } from 'react'
import { Shield, BarChart2, FileText, MessageSquare, Grid } from 'lucide-react'
import Tabs from '@/components/ui/Tabs'
import CIITracker from './CIITracker'
import ETSTracker from './ETSTracker'
import EmissionsLog from './EmissionsLog'
import ComplianceChat from './ComplianceChat'
import FleetMatrix from './FleetMatrix'

type Tab = 'cii' | 'ets' | 'emissions' | 'chat' | 'matrix'

const TABS = [
  { id: 'cii' as Tab, label: 'CII Tracker', icon: BarChart2 },
  { id: 'ets' as Tab, label: 'EU ETS', icon: Shield },
  { id: 'emissions' as Tab, label: 'Emissions Log', icon: FileText },
  { id: 'chat' as Tab, label: 'Compliance Chat', icon: MessageSquare },
  { id: 'matrix' as Tab, label: 'Fleet Matrix', icon: Grid },
]

export default function CompliancePage() {
  const [activeTab, setActiveTab] = useState<Tab>('cii')

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6">
        <h1 className="text-[23px] font-semibold text-[#f0f1f3] tracking-[-0.01em]">Compliance</h1>
        <p className="text-[#767d88] text-[13px] mt-[5px]">CII, EU ETS, Emissions monitoring and MARPOL compliance</p>
      </div>

      <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} className="mb-6 flex-shrink-0 overflow-x-auto" />

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
