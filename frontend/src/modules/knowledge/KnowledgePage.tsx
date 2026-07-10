import { useState } from 'react'
import { MessageSquare, BookOpen, FileWarning, ClipboardList } from 'lucide-react'
import Tabs from '@/components/ui/Tabs'
import KnowledgeChat from './KnowledgeChat'
import DocumentManager from './DocumentManager'
import DefectReportGenerator from './DefectReportGenerator'
import ShiftHandover from './ShiftHandover'

type Tab = 'chat' | 'documents' | 'defects' | 'handover'

const TABS = [
  { id: 'chat' as Tab, label: 'AI Assistant', icon: MessageSquare },
  { id: 'documents' as Tab, label: 'Knowledge Base', icon: BookOpen },
  { id: 'defects' as Tab, label: 'Defect Reports', icon: FileWarning },
  { id: 'handover' as Tab, label: 'Shift Handover', icon: ClipboardList },
]

export default function KnowledgePage() {
  const [activeTab, setActiveTab] = useState<Tab>('chat')

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6">
        <h1 className="text-[23px] font-semibold text-[#f0f1f3] tracking-[-0.01em]">Knowledge & Operations</h1>
        <p className="text-[#767d88] text-[13px] mt-[5px]">AI-powered vessel knowledge assistant and technical documentation</p>
      </div>

      <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} className="mb-6 flex-shrink-0 overflow-x-auto" />

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'chat' && <KnowledgeChat />}
        {activeTab === 'documents' && <div className="overflow-y-auto h-full"><DocumentManager /></div>}
        {activeTab === 'defects' && <div className="overflow-y-auto h-full"><DefectReportGenerator /></div>}
        {activeTab === 'handover' && <div className="overflow-y-auto h-full"><ShiftHandover /></div>}
      </div>
    </div>
  )
}
