import { useState } from 'react'
import { MessageSquare, BookOpen, FileWarning, ClipboardList } from 'lucide-react'
import KnowledgeChat from './KnowledgeChat'
import DocumentManager from './DocumentManager'
import DefectReportGenerator from './DefectReportGenerator'
import ShiftHandover from './ShiftHandover'

type Tab = 'chat' | 'documents' | 'defects' | 'handover'

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'AI Assistant', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'documents', label: 'Knowledge Base', icon: <BookOpen className="w-4 h-4" /> },
  { id: 'defects', label: 'Defect Reports', icon: <FileWarning className="w-4 h-4" /> },
  { id: 'handover', label: 'Shift Handover', icon: <ClipboardList className="w-4 h-4" /> },
]

export default function KnowledgePage() {
  const [activeTab, setActiveTab] = useState<Tab>('chat')

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Knowledge & Operations</h1>
        <p className="text-gray-400 text-sm mt-1">AI-powered vessel knowledge assistant and technical documentation</p>
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

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'chat' && <KnowledgeChat />}
        {activeTab === 'documents' && <div className="overflow-y-auto h-full"><DocumentManager /></div>}
        {activeTab === 'defects' && <div className="overflow-y-auto h-full"><DefectReportGenerator /></div>}
        {activeTab === 'handover' && <div className="overflow-y-auto h-full"><ShiftHandover /></div>}
      </div>
    </div>
  )
}
