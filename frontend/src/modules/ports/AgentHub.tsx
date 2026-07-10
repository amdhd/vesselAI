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
  const [copied, setCopied] = useState(false)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [markedSent, setMarkedSent] = useState(false)

  const generateMessage = async () => {
    if (!selectedPortCall) return
    setIsGenerating(true)
    setGeneratedMsg(null)

    try {
      const data = await voyageApi.generateAgentMessage({
        portCallId: selectedPortCall.id,
        type: messageType,
        vesselId: selectedPortCall.vesselId,
        portName: selectedPortCall.portName,
      })
      setGeneratedMsg(data)
    } catch {
      // Mock response
      const vessel = MOCK_VESSELS.find((v) => v.id === selectedPortCall.vesselId)
      const now = new Date()
      const eta = new Date(selectedPortCall.eta)
      const subjectMap: Record<MessageType, string> = {
        pre_arrival: `PRE-ARRIVAL NOTICE — ${vessel?.name ?? ''} — ETA ${formatDate(eta)}`,
        eta_update: `ETA UPDATE — ${vessel?.name ?? ''} — Revised ETA ${formatDate(eta)}`,
        berth_request: `BERTH REQUEST — ${vessel?.name ?? ''} — ${selectedPortCall.portName}`,
        departure_notice: `DEPARTURE NOTICE — ${vessel?.name ?? ''} — Departing ${formatDate(now)}`,
      }
      const body = generateMockBody(messageType, vessel?.name ?? 'Vessel', selectedPortCall, now)
      setGeneratedMsg({
        subject: subjectMap[messageType],
        to: selectedPortCall.agentEmail ?? 'agent@port.com',
        body,
      })
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
        <h2 className="text-lg font-semibold text-white">Agent Communication Hub</h2>
        <p className="text-gray-400 text-sm mt-0.5">AI-generated port agent messages and communication tracking</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Port calls list */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Active Port Calls</h3>
          {MOCK_PORT_CALLS.map((pc) => {
            const vessel = MOCK_VESSELS.find((v) => v.id === pc.vesselId)
            const isSent = sentIds.has(pc.id)
            return (
              <button
                key={pc.id}
                onClick={() => { setSelectedPortCall(pc); setGeneratedMsg(null) }}
                className={`w-full text-left card hover:border-teal-700 transition-colors ${
                  selectedPortCall?.id === pc.id ? 'border-teal-600' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-white text-sm truncate">{vessel?.name ?? 'Unknown'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{pc.portName}, {pc.country}</p>
                    <p className="text-xs text-gray-500 mt-0.5">ETA: {formatDate(pc.eta)}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`badge-${pc.status === 'arrived' ? 'healthy' : 'info'} text-xs`}>
                        {pc.status}
                      </span>
                      {isSent && <span className="badge-healthy text-xs">Message Sent</span>}
                    </div>
                  </div>
                  <ChevronRight className={`w-4 h-4 flex-shrink-0 mt-1 ${selectedPortCall?.id === pc.id ? 'text-teal-400' : 'text-gray-600'}`} />
                </div>
              </button>
            )
          })}
        </div>

        {/* Message generator */}
        <div className="lg:col-span-3">
          {!selectedPortCall ? (
            <div className="card flex items-center justify-center h-64 text-gray-500 flex-col gap-2">
              <MessageSquare className="w-10 h-10 opacity-30" />
              <p>Select a port call to generate a message</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-center gap-2 mb-4">
                  <Mail className="w-5 h-5 text-teal-400" />
                  <h3 className="font-semibold text-white">Generate Agent Message</h3>
                </div>

                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-2">Message Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(MESSAGE_TYPE_LABELS) as MessageType[]).map((type) => (
                      <button
                        key={type}
                        onClick={() => setMessageType(type)}
                        className={`text-sm px-3 py-2 rounded-[2px] text-left transition-colors border ${
                          messageType === type
                            ? 'bg-teal-600/15 text-teal-400 border-teal-600'
                            : 'bg-[#12161a] text-gray-300 border-white/[0.1] hover:border-white/20'
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
                      <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin" />
                      Generating with AI...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Generate with AI
                    </>
                  )}
                </button>
              </div>

              {generatedMsg && (
                <div className="card space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-white text-sm">Generated Message</h3>
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

                  <div className="bg-navy-900 rounded-[2px] p-4 space-y-3 border border-navy-700">
                    <div className="flex gap-2 text-sm">
                      <span className="text-gray-400 w-16 flex-shrink-0">To:</span>
                      <span className="text-teal-400">{generatedMsg.to}</span>
                    </div>
                    <div className="flex gap-2 text-sm">
                      <span className="text-gray-400 w-16 flex-shrink-0">Subject:</span>
                      <span className="text-white font-medium">{generatedMsg.subject}</span>
                    </div>
                    <div className="border-t border-navy-700 pt-3">
                      <pre className="text-gray-300 text-sm whitespace-pre-wrap font-sans leading-relaxed">
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

function generateMockBody(type: MessageType, vesselName: string, pc: PortCall, now: Date): string {
  const eta = new Date(pc.eta)
  const dateStr = eta.toUTCString().replace(' GMT', ' UTC')

  const bodies: Record<MessageType, string> = {
    pre_arrival: `Dear ${pc.agentName ?? 'Port Agent'},

We hereby give you pre-arrival notice for the following vessel:

Vessel: ${vesselName}
Port of Call: ${pc.portName}, ${pc.country}
ETA: ${dateStr}
Purpose: ${pc.cargoOps ?? 'Loading/Discharging operations'}
Laytime Allowed: ${pc.layTimeAllowed} hours
Demurrage Rate: USD ${pc.demurrageRate.toLocaleString()}/day

Kindly arrange for the necessary port formalities, berth allocation, and customs clearance. We request prompt confirmation of berth availability.

Vessel documents will be forwarded separately.

Best regards,
Fleet Operations — PETRONAS Marine`,

    eta_update: `Dear ${pc.agentName ?? 'Port Agent'},

Please note the following ETA update for ${vesselName}:

REVISED ETA: ${dateStr}
Reason: Updated weather routing and voyage optimization
Previous ETA: As per pre-arrival notice

All other details remain unchanged. Please update your records and advise berth availability accordingly.

We apologize for any inconvenience caused.

Best regards,
Fleet Operations — PETRONAS Marine`,

    berth_request: `Dear ${pc.agentName ?? 'Port Agent'},

We hereby formally request berth allocation for ${vesselName}:

ETA: ${dateStr}
LOA: 183m
Beam: 32m
Draft: 11.2m (laden)
Cargo: As per charter party terms
Estimated berth time: ${pc.layTimeAllowed} hours

Please confirm berth number and mooring arrangements at your earliest convenience.

Best regards,
Fleet Operations — PETRONAS Marine`,

    departure_notice: `Dear ${pc.agentName ?? 'Port Agent'},

This serves as departure notice for ${vesselName}:

ETD: ${now.toUTCString().replace(' GMT', ' UTC')}
Next port: As per voyage orders
Cargo completed: As per BL
Draft on departure: 12.4m

All documents have been settled. Kindly issue port clearance and arrange for customs departure formalities.

Thank you for your assistance during our port stay.

Best regards,
Fleet Operations — PETRONAS Marine`,
  }

  return bodies[type]
}
