import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Shield, FileText, AlertTriangle, MessageSquare, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { sireApi } from '@/lib/api'
import { MOCK_SIRE_DOCS, MOCK_SIRE_FINDINGS, MOCK_SIRE_CHAPTERS } from '@/lib/mockData'
import type { SireDocument, SireFinding, SireChapterScore } from '@/lib/types'
import { formatDate, cn } from '@/lib/utils'
import ChatMarkdown from '@/components/ui/ChatMarkdown'
import Badge from '@/components/ui/Badge'
import Tabs from '@/components/ui/Tabs'

const statusColor: Record<'green' | 'amber' | 'red', string> = {
  green: '#4a9d6f',
  amber: '#c99a54',
  red: '#a8443b',
}

type Tab = 'readiness' | 'documents' | 'findings' | 'chat'

const TABS = [
  { id: 'readiness' as Tab, label: 'Readiness Score', icon: Shield },
  { id: 'documents' as Tab, label: 'Documents', icon: FileText },
  { id: 'findings' as Tab, label: 'Findings', icon: AlertTriangle },
  { id: 'chat' as Tab, label: 'Inspector Chat', icon: MessageSquare },
]

function ChapterRow({ chapter, index }: { chapter: SireChapterScore; index: number }) {
  const pct = Math.round((chapter.score / chapter.maxScore) * 100)
  return (
    <div className="flex items-center gap-4 py-[13px] border-b border-white/[0.05] last:border-b-0">
      <span className="font-mono text-[11.5px] text-[#454b55] w-4">{index + 1}</span>
      <span className="text-[#e2e4e7] text-[13px] flex-1 truncate">{chapter.title}</span>
      <div className="w-32 h-[5px] bg-white/[0.06] relative">
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${pct}%`, background: statusColor[chapter.status] }}
        />
      </div>
      <span className="font-mono text-[13px] font-semibold w-8 text-right" style={{ color: statusColor[chapter.status] }}>
        {chapter.score}
      </span>
      <span className="text-[11.5px] text-[#767d88] w-20 text-right">
        {chapter.findings} finding{chapter.findings !== 1 ? 's' : ''}
      </span>
    </div>
  )
}

function DocumentRow({ doc }: { doc: SireDocument }) {
  return (
    <div className="flex items-center justify-between p-3 bg-navy-700/40 border border-navy-600/50 rounded-[2px]">
      <div className="flex items-center gap-3">
        {doc.status === 'valid' ? (
          <CheckCircle className="w-4 h-4 text-status-green shrink-0" />
        ) : doc.status === 'expiring_soon' ? (
          <Clock className="w-4 h-4 text-status-amber shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-status-red shrink-0" />
        )}
        <div>
          <p className="text-white text-sm font-medium">{doc.name}</p>
          <p className="text-gray-500 text-xs capitalize">{doc.type}</p>
        </div>
      </div>
      <div className="text-right">
        {doc.expiryDate && (
          <p className="text-gray-400 text-xs font-mono">Expires {formatDate(doc.expiryDate)}</p>
        )}
        <span className={cn('text-xs', {
          'text-status-green': doc.status === 'valid',
          'text-status-amber': doc.status === 'expiring_soon',
          'text-status-red': doc.status === 'expired',
        })}>
          {doc.status === 'valid' ? 'Valid' : doc.status === 'expiring_soon' ? 'Expiring Soon' : 'Expired'}
        </span>
      </div>
    </div>
  )
}

function FindingRow({ finding }: { finding: SireFinding }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={cn('card', {
      'border-status-red': finding.severity === 'major',
      'border-status-amber': finding.severity === 'deficiency',
      'border-navy-700': finding.severity === 'observation',
    })}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant={
                finding.severity === 'major' ? 'critical' : finding.severity === 'deficiency' ? 'warning' : 'info'
              }
              className="capitalize"
            >
              {finding.severity}
            </Badge>
            <span className="text-gray-500 text-xs">Ch.{finding.chapter}: {finding.chapterTitle}</span>
            <span className={cn('text-xs capitalize', {
              'text-status-green': finding.status === 'closed' || finding.status === 'verified',
              'text-status-amber': finding.status === 'in_progress',
              'text-status-red': finding.status === 'open',
            })}>
              {finding.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-white text-sm mt-2">{finding.finding}</p>
          {finding.dueDate && (
            <p className="text-gray-500 text-xs mt-1 font-mono">Due: {formatDate(finding.dueDate)}</p>
          )}
        </div>
        {finding.correctiveAction && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-gray-400 hover:text-white transition-colors shrink-0"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>
      {expanded && finding.correctiveAction && (
        <div className="mt-3 p-3 bg-navy-700/50 rounded-[2px] border border-navy-600 text-xs text-gray-300">
          <span className="text-teal-400 font-medium">Corrective action: </span>
          {finding.correctiveAction}
        </div>
      )}
    </div>
  )
}

function ReadinessTab({ vesselId }: { vesselId: string }) {
  const { data: score, isLoading } = useQuery({
    queryKey: ['sire-readiness', vesselId],
    queryFn: async () => {
      try {
        return await sireApi.getReadinessScore(vesselId)
      } catch {
        const chapters = MOCK_SIRE_CHAPTERS[vesselId] ?? MOCK_SIRE_CHAPTERS['v1']
        const avg = chapters.reduce((s, c) => s + c.score, 0) / chapters.length
        return { score: Math.round(avg), chapters }
      }
    },
  })

  const [isGenerating, setIsGenerating] = useState(false)

  const chapters: SireChapterScore[] = (score as { chapters?: SireChapterScore[] } | undefined)?.chapters ?? MOCK_SIRE_CHAPTERS[vesselId] ?? MOCK_SIRE_CHAPTERS['v1']
  const overallScore = (score as { score?: number } | undefined)?.score ?? 0

  if (isLoading) {
    return (
      <div className="card animate-pulse space-y-3">
        <div className="h-6 bg-navy-700 rounded w-1/3" />
        <div className="h-32 bg-navy-700 rounded" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Overall score */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-white">SIRE 2.0 Readiness Score</h2>
          <button
            disabled={isGenerating}
            onClick={() => {
              setIsGenerating(true)
              sireApi.generatePreInspectionReport(vesselId)
                .then(() => setIsGenerating(false))
                .catch(() => setIsGenerating(false))
            }}
            className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {isGenerating ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            Generate Pre-Inspection Report
          </button>
        </div>
        <div className="flex items-center gap-8">
          <div className="relative w-24 h-24 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={overallScore >= 80 ? '#4a9d6f' : overallScore >= 60 ? '#c99a54' : '#a8443b'}
                strokeWidth="10"
                strokeDasharray={`${2 * Math.PI * 40}`}
                strokeDashoffset={`${2 * Math.PI * 40 * (1 - overallScore / 100)}`}
                strokeLinecap="round"
                transform="rotate(-90 50 50)"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-mono text-2xl font-semibold text-white">{overallScore}</span>
            </div>
          </div>
          <div className="flex-1">
            <p className="text-gray-400 text-sm">
              {overallScore >= 80 ? 'Excellent readiness — vessel is well-prepared for SIRE inspection' :
               overallScore >= 60 ? 'Good readiness — some areas need attention before inspection' :
               'Low readiness — significant deficiencies must be addressed urgently'}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-px bg-navy-700 border border-navy-700">
              {[
                { label: 'Chapters', value: chapters.length },
                { label: 'Green', value: chapters.filter((c) => c.status === 'green').length },
                { label: 'Issues', value: chapters.reduce((s, c) => s + c.findings, 0) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-navy-800 p-2.5 text-center">
                  <p className="font-mono text-white font-semibold text-lg">{value}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Chapter scores */}
      <div className="card">
        <h3 className="font-semibold text-white mb-1">Chapter Scores</h3>
        <div>
          {chapters.map((ch, i) => <ChapterRow key={ch.chapter} chapter={ch} index={i} />)}
        </div>
      </div>
    </div>
  )
}

function DocumentsTab({ vesselId }: { vesselId: string }) {
  const { data: docs, isLoading } = useQuery<SireDocument[]>({
    queryKey: ['sire-docs', vesselId],
    queryFn: async () => {
      try {
        return await sireApi.getDocuments(vesselId)
      } catch {
        return MOCK_SIRE_DOCS.filter((d) => d.vesselId === vesselId)
      }
    },
  })

  if (isLoading) return <div className="card animate-pulse h-48" />

  const expired = docs?.filter((d) => d.status === 'expired').length ?? 0
  const expiring = docs?.filter((d) => d.status === 'expiring_soon').length ?? 0

  return (
    <div className="space-y-4">
      {(expired > 0 || expiring > 0) && (
        <div className="flex gap-3">
          {expired > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-navy-800 border border-status-red rounded-[2px] text-status-red text-sm">
              <XCircle className="w-4 h-4" />
              {expired} expired certificate{expired !== 1 ? 's' : ''}
            </div>
          )}
          {expiring > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-navy-800 border border-status-amber rounded-[2px] text-status-amber text-sm">
              <Clock className="w-4 h-4" />
              {expiring} expiring soon
            </div>
          )}
        </div>
      )}
      <div className="card space-y-3">
        <h3 className="font-semibold text-white">Vessel Certificates & Documents</h3>
        {!docs || docs.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No documents found</p>
        ) : (
          docs.map((doc) => <DocumentRow key={doc.id} doc={doc} />)
        )}
      </div>
    </div>
  )
}

function FindingsTab({ vesselId }: { vesselId: string }) {
  const { data: findings, isLoading } = useQuery<SireFinding[]>({
    queryKey: ['sire-findings', vesselId],
    queryFn: async () => {
      try {
        return await sireApi.getFindings(vesselId)
      } catch {
        return MOCK_SIRE_FINDINGS.filter((f) => f.vesselId === vesselId)
      }
    },
  })

  if (isLoading) return <div className="card animate-pulse h-48" />

  const open = findings?.filter((f) => f.status === 'open').length ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-sm text-gray-400">
        <span>{findings?.length ?? 0} total findings</span>
        {open > 0 && <span className="text-status-red font-medium">{open} open</span>}
      </div>
      {!findings || findings.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle className="w-12 h-12 text-status-green mb-3" />
          <p className="text-white font-semibold">No findings on record</p>
          <p className="text-gray-400 text-sm mt-1">This vessel has no SIRE inspection findings</p>
        </div>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => <FindingRow key={f.id} finding={f} />)}
        </div>
      )}
    </div>
  )
}

function ChatTab({ vesselId }: { vesselId: string }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    { role: 'assistant', content: 'Hello! I\'m your SIRE 2.0 inspector AI. I can simulate inspector questions, help you prepare for the inspection, and assess your vessel\'s readiness. What would you like to practice?' }
  ])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return
    const userMsg = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }])
    setIsStreaming(true)

    try {
      const res = await sireApi.inspectorChatStream({
        vesselId,
        message: userMsg,
        conversationHistory: messages,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(err.error || `Error ${res.status}`)
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let assistantMsg = ''
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') break
            try {
              const parsed = JSON.parse(data) as { text: string }
              assistantMsg += parsed.text
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: assistantMsg }
                return updated
              })
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'I apologize, I\'m unable to connect to the AI service right now. Please check the vessel\'s Certificate of Fitness and ensure all safety equipment is properly maintained and tested.',
        },
      ])
    } finally {
      setIsStreaming(false)
    }
  }

  return (
    <div className="card flex flex-col h-[520px]">
      <div className="flex items-center gap-2 mb-4 pb-4 border-b border-navy-700">
        <MessageSquare className="w-4 h-4 text-teal-400" />
        <h3 className="font-semibold text-white text-sm">SIRE 2.0 Inspector Simulation</h3>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[85%] p-3 rounded-[2px] text-sm leading-relaxed',
              msg.role === 'user'
                ? 'bg-teal-600/20 border border-teal-600 text-white'
                : 'bg-navy-700 border border-navy-600 text-gray-200'
            )}>
              {msg.content ? (
                msg.role === 'assistant' ? <ChatMarkdown content={msg.content} /> : msg.content
              ) : (
                isStreaming && i === messages.length - 1 && (
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-100" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-200" />
                  </span>
                )
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Ask about inspection topics, request a practice question..."
          className="flex-1 bg-navy-700 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-600 transition-colors"
          disabled={isStreaming}
        />
        <button
          onClick={sendMessage}
          disabled={isStreaming || !input.trim()}
          className="btn-primary px-4 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  )
}

export default function SirePage() {
  const { selectedVessel } = useFleet()
  const [activeTab, setActiveTab] = useState<Tab>('readiness')

  if (!selectedVessel) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-[23px] font-semibold text-[#f0f1f3] tracking-[-0.01em]">SIRE Readiness</h1>
          <p className="text-[#767d88] text-[13px] mt-[5px]">SIRE 2.0 inspection preparation and compliance tracking</p>
        </div>
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <Shield className="w-12 h-12 text-gray-600 mb-4" />
          <h3 className="text-white font-semibold">No vessel selected</h3>
          <p className="text-gray-400 text-sm mt-2">Select a vessel from the top bar to view SIRE readiness</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[23px] font-semibold text-[#f0f1f3] tracking-[-0.01em]">SIRE Readiness</h1>
        <p className="text-[#767d88] text-[13px] mt-[5px]">
          SIRE 2.0 preparation for <span className="text-teal-400 font-medium">{selectedVessel.name}</span>
        </p>
      </div>

      {/* Tabs */}
      <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      {activeTab === 'readiness' && <ReadinessTab vesselId={selectedVessel.id} />}
      {activeTab === 'documents' && <DocumentsTab vesselId={selectedVessel.id} />}
      {activeTab === 'findings' && <FindingsTab vesselId={selectedVessel.id} />}
      {activeTab === 'chat' && <ChatTab vesselId={selectedVessel.id} />}
    </div>
  )
}
