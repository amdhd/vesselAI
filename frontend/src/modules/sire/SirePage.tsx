import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Shield, FileText, AlertTriangle, MessageSquare, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, Square } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { sireApi, type ChatStreamChunk } from '@/lib/api'
import AiFallbackNotice from '@/components/ui/AiFallbackNotice'
import { readSseStream } from '@/lib/sse'
import { describeApiError } from '@/lib/apiError'
import { MOCK_SIRE_DOCS, MOCK_SIRE_FINDINGS, MOCK_SIRE_CHAPTERS } from '@/lib/mockData'
import type { SireDocument, SireFinding, SireChapterScore, SireFindingsResponse } from '@/lib/types'
import { formatDate, cn } from '@/lib/utils'
import ChatMarkdown from '@/components/ui/ChatMarkdown'
import Badge from '@/components/ui/Badge'
import Tabs from '@/components/ui/Tabs'
import { tok } from '@/lib/theme'

const statusColor: Record<'green' | 'amber' | 'red', string> = {
  green: tok('accent'),
  amber: tok('apricot'),
  red: tok('critical'),
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
    <div className="flex items-center gap-4 py-[13px] border-b border-light/[0.05] last:border-b-0">
      <span className="tabular-nums text-[11.5px] text-faint-2 w-4">{index + 1}</span>
      <span className="text-ink text-[13px] flex-1 truncate">{chapter.title}</span>
      <div className="w-32 h-[5px] bg-light/[0.06] relative">
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${pct}%`, background: statusColor[chapter.status] }}
        />
      </div>
      <span className="tabular-nums text-[13px] font-semibold w-8 text-right" style={{ color: statusColor[chapter.status] }}>
        {chapter.score}
      </span>
      <span className="text-[11.5px] text-muted w-20 text-right">
        {chapter.findings} finding{chapter.findings !== 1 ? 's' : ''}
      </span>
    </div>
  )
}

function DocumentRow({ doc }: { doc: SireDocument }) {
  return (
    <div className="flex items-center justify-between p-3 bg-paper-3/40 border border-rule-2/50 rounded-inner">
      <div className="flex items-center gap-3">
        {doc.status === 'valid' ? (
          <CheckCircle className="w-4 h-4 text-status-green shrink-0" />
        ) : doc.status === 'expiring_soon' ? (
          <Clock className="w-4 h-4 text-status-amber shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-status-red shrink-0" />
        )}
        <div>
          <p className="text-ink text-sm font-medium">{doc.name}</p>
          <p className="text-faint text-xs capitalize">{doc.type}</p>
        </div>
      </div>
      <div className="text-right">
        {doc.expiryDate && (
          <p className="text-muted text-xs tabular-nums">Expires {formatDate(doc.expiryDate)}</p>
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
      // A non-conformance is the serious one. This used to key on 'major' and
      // 'deficiency' -- values the API has never sent -- so every real
      // non-conformance fell through to the observation styling and was shown
      // as the mildest class of finding.
      'border-status-red': finding.severity === 'non-conformance',
      'border-rule': finding.severity === 'observation',
    })}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant={finding.severity === 'non-conformance' ? 'critical' : 'info'}
              className="capitalize"
            >
              {finding.severity}
            </Badge>
            <span className="text-faint text-xs">Ch.{finding.chapter}: {finding.chapterTitle}</span>
            {/* The API sends 'open' | 'closed' and nothing else. The
                'verified' and 'in_progress' branches this replaced were dead,
                and the underscore replace below served a value that never
                arrived -- same imagined contract as the severity map above. */}
            <span className={cn('text-xs capitalize', {
              'text-status-green': finding.status === 'closed',
              'text-status-red': finding.status === 'open',
            })}>
              {finding.status}
            </span>
          </div>
          <p className="text-ink text-sm mt-2">{finding.finding}</p>
          {finding.dueDate && (
            <p className="text-faint text-xs mt-1 tabular-nums">Due: {formatDate(finding.dueDate)}</p>
          )}
        </div>
        {finding.correctiveAction && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-muted hover:text-ink transition-colors shrink-0"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>
      {expanded && finding.correctiveAction && (
        <div className="mt-3 p-3 bg-paper-3/50 rounded-inner border border-rule-2 text-xs text-ink-2">
          <span className="text-accent font-medium">Corrective action: </span>
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
        <div className="h-6 bg-paper-3 rounded w-1/3" />
        <div className="h-32 bg-paper-3 rounded" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Overall score */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-ink">SIRE 2.0 Readiness Score</h2>
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
              <div className="w-4 h-4 border-2 border-light border-t-transparent rounded-full animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            Generate Pre-Inspection Report
          </button>
        </div>
        <div className="flex items-center gap-8">
          <div className="relative w-24 h-24 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
              <circle cx="50" cy="50" r="40" fill="none" stroke={tok('light', 0.08)} strokeWidth="10" />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={overallScore >= 80 ? tok('accent') : overallScore >= 60 ? tok('apricot') : tok('critical')}
                strokeWidth="10"
                strokeDasharray={`${2 * Math.PI * 40}`}
                strokeDashoffset={`${2 * Math.PI * 40 * (1 - overallScore / 100)}`}
                strokeLinecap="round"
                transform="rotate(-90 50 50)"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="tabular-nums text-2xl font-semibold text-ink">{overallScore}</span>
            </div>
          </div>
          <div className="flex-1">
            <p className="text-muted text-sm">
              {overallScore >= 80 ? 'Excellent readiness — vessel is well-prepared for SIRE inspection' :
               overallScore >= 60 ? 'Good readiness — some areas need attention before inspection' :
               'Low readiness — significant deficiencies must be addressed urgently'}
            </p>
            <dl className="mt-4 grid grid-cols-3 divide-x divide-light/[0.06] border-y border-light/[0.06]">
              {[
                { label: 'Chapters', value: chapters.length },
                { label: 'Green', value: chapters.filter((c) => c.status === 'green').length },
                { label: 'Issues', value: chapters.reduce((s, c) => s + c.findings, 0) },
              ].map(({ label, value }) => (
                <div key={label} className="px-4 py-3">
                  <dt className="label">{label}</dt>
                  <dd className="font-display text-ink font-medium text-[22px] tabular-nums mt-0.5">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      {/* Chapter scores */}
      <div className="card">
        <h3 className="font-semibold text-ink mb-1">Chapter Scores</h3>
        <div>
          {chapters.map((ch, i) => <ChapterRow key={ch.chapter} chapter={ch} index={i} />)}
        </div>
      </div>
    </div>
  )
}

function DocumentsTab({ vesselId }: { vesselId: string }) {
  const { data: docs, isLoading, isError } = useQuery<SireDocument[]>({
    queryKey: ['sire-docs', vesselId],
    queryFn: async () => {
      try {
        return await sireApi.getDocuments(vesselId)
      } catch (err) {
        // Fixtures in dev only — a fabricated certificate list must never stand
        // in for a vessel's real SIRE documents in production.
        if (import.meta.env.DEV) return MOCK_SIRE_DOCS.filter((d) => d.vesselId === vesselId)
        throw err
      }
    },
  })

  if (isLoading) return <div className="card animate-pulse h-48" />
  if (isError) {
    return <div className="card text-muted text-sm text-center py-8">Could not load documents</div>
  }

  const expired = docs?.filter((d) => d.status === 'expired').length ?? 0
  const expiring = docs?.filter((d) => d.status === 'expiring_soon').length ?? 0

  return (
    <div className="space-y-4">
      {(expired > 0 || expiring > 0) && (
        <div className="flex gap-3">
          {expired > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-status-red/[0.06] border border-status-red/35 rounded-inner text-status-red text-sm">
              <XCircle className="w-4 h-4" />
              {expired} expired certificate{expired !== 1 ? 's' : ''}
            </div>
          )}
          {expiring > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-status-amber/[0.06] border border-status-amber/35 rounded-inner text-status-amber text-sm">
              <Clock className="w-4 h-4" />
              {expiring} expiring soon
            </div>
          )}
        </div>
      )}
      <div className="card space-y-3">
        <h3 className="font-semibold text-ink">Vessel Certificates & Documents</h3>
        {!docs || docs.length === 0 ? (
          <p className="text-muted text-sm text-center py-8">No documents found</p>
        ) : (
          docs.map((doc) => <DocumentRow key={doc.id} doc={doc} />)
        )}
      </div>
    </div>
  )
}

function FindingsTab({ vesselId }: { vesselId: string }) {
  const { data, isLoading, isError } = useQuery<SireFindingsResponse>({
    queryKey: ['sire-findings', vesselId],
    queryFn: async () => {
      try {
        return await sireApi.getFindings(vesselId)
      } catch (err) {
        // Fixtures in dev only (see DocumentsTab).
        if (!import.meta.env.DEV) throw err
        const fallback = MOCK_SIRE_FINDINGS.filter((f) => f.vesselId === vesselId)
        return {
          findings: fallback,
          summary: {
            total: fallback.length,
            open: fallback.filter((f) => f.status === 'open').length,
            closed: fallback.filter((f) => f.status === 'closed').length,
            nonConformances: fallback.filter((f) => f.severity === 'non-conformance').length,
            observations: fallback.filter((f) => f.severity === 'observation').length,
          },
        }
      }
    },
  })

  if (isLoading) return <div className="card animate-pulse h-48" />
  if (isError) {
    return <div className="card text-muted text-sm text-center py-8">Could not load findings</div>
  }

  const findings = data?.findings
  // From the server, not recomputed. One source of truth for a number the
  // backend already publishes.
  const open = data?.summary.open ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-sm text-muted">
        <span>{findings?.length ?? 0} total findings</span>
        <span className={open > 0 ? 'text-status-red font-medium' : 'text-muted'}>
          {open} open
        </span>
      </div>
      {!findings || findings.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle className="w-12 h-12 text-status-green mb-3" />
          <p className="text-ink font-semibold">No findings on record</p>
          <p className="text-muted text-sm mt-1">This vessel has no SIRE inspection findings</p>
        </div>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => <FindingRow key={f.id} finding={f} />)}
        </div>
      )}
    </div>
  )
}

interface InspectorMessage {
  role: 'user' | 'assistant'
  content: string
  // Set when the server substituted this text after an upstream AI failure,
  // so the bubble can say so instead of passing it off as an answer.
  fallback?: { rateLimited?: boolean; retryAfter?: number }
}

function ChatTab({ vesselId }: { vesselId: string }) {
  const [messages, setMessages] = useState<InspectorMessage[]>([
    { role: 'assistant', content: 'Hello! I\'m your SIRE 2.0 inspector AI. I can simulate inspector questions, help you prepare for the inspection, and assess your vessel\'s readiness. What would you like to practice?' }
  ])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  // Cancels the in-flight request, which also closes the server-side stream
  // rather than leaving it generating tokens nobody will read.
  const abortRef = useRef<AbortController | null>(null)

  const stopStreaming = () => abortRef.current?.abort()

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return
    const userMsg = input.trim()
    setInput('')
    // The assistant placeholder goes in up front, so every outcome below —
    // tokens, an AI fallback, or a failure — replaces the same message instead
    // of appending another one next to it.
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }, { role: 'assistant', content: '' }])
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    // The reply is always the final entry; patch it in place.
    const patchReply = (patch: Partial<InspectorMessage>) =>
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { ...updated[updated.length - 1], ...patch }
        return updated
      })

    let assistantMsg = ''

    try {
      const res = await sireApi.inspectorChatStream({
        vesselId,
        message: userMsg,
        conversationHistory: messages,
        signal: controller.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: null }))
        throw new Error(err.error || `The inspector simulation returned ${res.status}.`)
      }

      await readSseStream<ChatStreamChunk>(res, (chunk) => {
        if (chunk.aiFallback) {
          patchReply({ content: chunk.text ?? '', fallback: { rateLimited: chunk.rateLimited, retryAfter: chunk.retryAfter } })
          return
        }
        if (chunk.text) {
          assistantMsg += chunk.text
          patchReply({ content: assistantMsg })
        }
      })
    } catch (err) {
      if (!controller.signal.aborted) {
        patchReply({
          content: describeApiError(err, 'Unable to reach the SIRE inspector AI. Please check your connection and try again.'),
        })
      }
    } finally {
      abortRef.current = null
      setIsStreaming(false)
    }
  }

  return (
    <div className="card flex flex-col h-[520px]">
      <div className="flex items-center gap-2 mb-4 pb-4 border-b border-rule">
        <MessageSquare className="w-4 h-4 text-accent" />
        <h3 className="font-semibold text-ink text-sm">SIRE 2.0 Inspector Simulation</h3>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[85%] p-3 rounded-inner text-sm leading-relaxed',
              msg.role === 'user'
                ? 'bg-accent/[0.12] border border-accent/25 text-ink'
                : 'bg-paper-3 border border-rule-2 text-ink'
            )}>
              {msg.fallback && <AiFallbackNotice {...msg.fallback} />}
              {msg.content ? (
                msg.role === 'assistant' ? <ChatMarkdown content={msg.content} /> : msg.content
              ) : (
                isStreaming && i === messages.length - 1 && (
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-muted rounded-full animate-pulse" />
                    <span className="w-1.5 h-1.5 bg-muted rounded-full animate-pulse delay-100" />
                    <span className="w-1.5 h-1.5 bg-muted rounded-full animate-pulse delay-200" />
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
          className="flex-1 bg-paper-3 border border-rule-2 rounded-inner px-3 py-2 text-ink text-sm placeholder-faint focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors"
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button
            onClick={stopStreaming}
            title="Stop generating"
            className="px-4 text-sm rounded-inner border border-rule-2 text-muted hover:border-status-red hover:text-status-red transition-colors"
          >
            <Square className="w-3.5 h-3.5 fill-current inline" />
          </button>
        ) : (
          <button
            onClick={sendMessage}
            disabled={!input.trim()}
            className="btn-primary px-4 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        )}
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
          <h1 className="text-[23px] font-semibold text-ink tracking-[-0.01em]">SIRE Readiness</h1>
          <p className="text-muted text-[13px] mt-[5px]">SIRE 2.0 inspection preparation and compliance tracking</p>
        </div>
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <Shield className="w-12 h-12 text-faint-2 mb-4" />
          <h3 className="text-ink font-semibold">No vessel selected</h3>
          <p className="text-muted text-sm mt-2">Select a vessel from the top bar to view SIRE readiness</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[23px] font-semibold text-ink tracking-[-0.01em]">SIRE Readiness</h1>
        <p className="text-muted text-[13px] mt-[5px]">
          SIRE 2.0 preparation for <span className="text-accent font-medium">{selectedVessel.name}</span>
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
