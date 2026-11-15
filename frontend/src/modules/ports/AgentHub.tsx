import { useState } from 'react'
import { MessageSquare, Copy, CheckCircle, Send, Mail, ChevronRight } from 'lucide-react'
import { MOCK_PORT_CALLS, MOCK_VESSELS } from '@/lib/mockData'
import type { PortCall } from '@/lib/types'
import { voyageApi } from '@/lib/api'
import { formatDate } from '@/lib/utils'

type MessageType = 'pre_arrival' | 'eta_update' | 'berth_request' | 'departure_notice'

const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  pre_arrival: 'Pre-Arrival Notice',
  eta_update: 'ETA Update',
  berth_request: 'Berth Request',
  departure_notice: 'Departure Notice',
}

interface GeneratedMessage {
  subject: string
  to: string
  body: string
}

export default function AgentHub() {
  const [selectedPortCall, setSelectedPortCall] = useState<PortCall | null>(null)
  const [messageType, setMessageType] = useState<MessageType>('pre_arrival')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedMsg, setGeneratedMsg] = useState<GeneratedMessage | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [markedSent, setMarkedSent] = useState(false)

  const generateMessage = async () => {
    if (!selectedPortCall) return
    setIsGenerating(true)
    setGeneratedMsg(null)
    setError('')

    try {
      const data = await voyageApi.generateAgentMessage({
        portCallId: selectedPortCall.id,
        type: messageType,
        vesselId: selectedPortCall.vesselId,
        portName: selectedPortCall.portName,
      })
      setGeneratedMsg(data)
    } catch {
      // This used to fall back to a locally composed notice built from fixture
      // data, so a backend failure produced a letter that looked ready to send
      // to a port agent but carried figures no one had verified. Say it failed.
      setError('Could not reach the message service. Check your connection and try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = () => {
    if (!generatedMsg) return
    const text = `Subject: ${generatedMsg.subject}\nTo: ${generatedMsg.to}\n\n${generatedMsg.body}`
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleMarkSent = () => {
    if (!selectedPortCall) return
    setSentIds((prev) => new Set([...prev, selectedPortCall.id]))
    setMarkedSent(true)
    setTimeout(() => setMarkedSent(false), 3000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Agent Communication Hub</h2>
        <p className="text-muted text-sm mt-0.5">AI-generated port agent messages and communication tracking</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Port calls list */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-sm font-semibold text-muted">Active Port Calls</h3>
          {MOCK_PORT_CALLS.map((pc) => {
            const vessel = MOCK_VESSELS.find((v) => v.id === pc.vesselId)
            const isSent = sentIds.has(pc.id)
            return (
              <button
                key={pc.id}
                onClick={() => { setSelectedPortCall(pc); setGeneratedMsg(null) }}
                className={`w-full text-left card hover:border-accent-hi transition-colors ${
                  selectedPortCall?.id === pc.id ? 'border-accent' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink text-sm truncate">{vessel?.name ?? 'Unknown'}</p>
                    <p className="text-xs text-muted mt-0.5">{pc.portName}, {pc.country}</p>
                    <p className="text-xs text-faint mt-0.5">ETA: {formatDate(pc.eta)}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`badge-${pc.status === 'arrived' ? 'healthy' : 'info'} text-xs`}>
                        {pc.status}
                      </span>
                      {isSent && <span className="badge-healthy text-xs">Message Sent</span>}
                    </div>
                  </div>
                  <ChevronRight className={`w-4 h-4 flex-shrink-0 mt-1 ${selectedPortCall?.id === pc.id ? 'text-accent' : 'text-faint-2'}`} />
                </div>
              </button>
            )
          })}
        </div>

        {/* Message generator */}
        <div className="lg:col-span-3">
          {!selectedPortCall ? (
            <div className="card flex items-center justify-center h-64 text-faint flex-col gap-2">
              <MessageSquare className="w-10 h-10 opacity-30" />
              <p>Select a port call to generate a message</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-center gap-2 mb-4">
                  <Mail className="w-5 h-5 text-accent" />
                  <h3 className="font-semibold text-ink">Generate Agent Message</h3>
                </div>

                <div className="mb-4">
                  <label className="block text-sm text-muted mb-2">Message Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(MESSAGE_TYPE_LABELS) as MessageType[]).map((type) => (
                      <button
                        key={type}
                        onClick={() => setMessageType(type)}
                        className={`text-sm px-3 py-2 rounded-inner text-left transition-colors border ${
                          messageType === type
                            ? 'bg-accent/15 text-accent border-accent'
                            : 'bg-paper-2 text-ink-2 border-light/[0.1] hover:border-light/20'
                        }`}
                      >
                        {MESSAGE_TYPE_LABELS[type]}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => void generateMessage()}
                  disabled={isGenerating}
                  className="w-full btn-primary flex items-center justify-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-4 h-4 border border-light border-t-transparent rounded-full animate-spin" />
                      Generating with AI...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Generate with AI
                    </>
                  )}
                </button>

                {error && (
                  <div role="alert" className="mt-3 bg-critical/10 border border-critical/30 text-critical text-[13px] rounded-inner px-4 py-3">
                    {error}
                  </div>
                )}
              </div>

              {generatedMsg && (
                <div className="card space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-ink text-sm">Generated Message</h3>
                    <div className="flex gap-2">
                      <button
                        onClick={handleCopy}
                        className="btn-secondary text-xs flex items-center gap-1 py-1.5 px-3"
                      >
                        {copied ? <CheckCircle className="w-3 h-3 text-status-green" /> : <Copy className="w-3 h-3" />}
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                      <button
                        onClick={handleMarkSent}
                        className="btn-primary text-xs flex items-center gap-1 py-1.5 px-3"
                      >
                        <CheckCircle className="w-3 h-3" />
                        Mark as Sent
                      </button>
                    </div>
                  </div>

                  <div className="bg-paper rounded-inner p-4 space-y-3 border border-rule">
                    <div className="flex gap-2 text-sm">
                      <span className="text-muted w-16 flex-shrink-0">To:</span>
                      <span className="text-accent">{generatedMsg.to}</span>
                    </div>
                    <div className="flex gap-2 text-sm">
                      <span className="text-muted w-16 flex-shrink-0">Subject:</span>
                      <span className="text-ink font-medium">{generatedMsg.subject}</span>
                    </div>
                    <div className="border-t border-rule pt-3">
                      <pre className="text-ink-2 text-sm whitespace-pre-wrap font-sans leading-relaxed">
                        {generatedMsg.body}
                      </pre>
                    </div>
                  </div>

                  {markedSent && (
                    <div className="flex items-center gap-2 text-status-green text-sm">
                      <CheckCircle className="w-4 h-4" />
                      Message marked as sent successfully.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
