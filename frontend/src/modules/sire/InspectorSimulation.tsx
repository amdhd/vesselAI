import { useState, useRef, useEffect } from 'react'
import { Send, User, ClipboardList, Shield } from 'lucide-react'
import { useFleet } from '../../context/FleetContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const OPENING_STARTERS = [
  'Begin Bridge Inspection',
  'Start Machinery Space Inspection',
  'Review Safety Equipment & Drills',
  'Check Pollution Prevention Records',
]

const INSPECTOR_INTRO: Message = {
  id: 'intro',
  role: 'assistant',
  content: `Good morning, Captain. I am the SIRE inspector assigned to carry out today's vetting inspection.

Before we begin, I want to confirm that I will be conducting a thorough inspection covering all chapters of the SIRE VIQ. The inspection will take approximately 6-8 hours.

Let's begin with the bridge. Could you please take me to the bridge and show me:
1. The current passage plan and confirm it has been reviewed and signed by the Master
2. The ECDIS settings and chart correction records
3. The bridge watchkeeping arrangements and officer qualification certificates

Please proceed when ready.`,
}

export default function InspectorSimulation() {
  const { selectedVessel } = useFleet()
  const [messages, setMessages] = useState<Message[]>([INSPECTOR_INTRO])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (content: string) => {
    if (!content.trim() || isStreaming) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content }
    const aiId = Date.now().toString() + '-ai'
    const aiMsg: Message = { id: aiId, role: 'assistant', content: '' }

    setMessages(prev => [...prev, userMsg, aiMsg])
    setInput('')
    setIsStreaming(true)

    try {
      const history = messages.slice(-8).map(m => ({ role: m.role, content: m.content }))
      const response = await fetch('/api/sire/inspector-simulation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          vesselId: selectedVessel?.id || 'vessel-001',
          message: content,
          history,
        }),
      })

      if (!response.body) throw new Error('No response body')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.text) {
                setMessages(prev => prev.map(m => m.id === aiId ? { ...m, content: m.content + data.text } : m))
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === aiId ? { ...m, content: 'Inspector simulation temporarily unavailable. Please ensure your API key is configured.' } : m
      ))
    } finally {
      setIsStreaming(false)
    }
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 240px)' }}>
      {/* Inspector header */}
      <div className="bg-amber-900/20 border border-amber-800 rounded-lg p-4 mb-4 flex items-center gap-4">
        <div className="w-12 h-12 bg-amber-900/50 rounded-full flex items-center justify-center border border-amber-700">
          <Shield size={24} className="text-amber-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-amber-400 font-bold">INSPECTOR MODE ACTIVE</span>
            <span className="text-xs bg-amber-900 text-amber-300 px-2 py-0.5 rounded border border-amber-700">SIRE VIQ</span>
          </div>
          <p className="text-gray-400 text-sm">
            Claude is simulating a SIRE inspector for{' '}
            <span className="text-white font-medium">{selectedVessel?.name || 'MV Merdeka Spirit'}</span>
          </p>
        </div>
        <button
          onClick={() => setMessages([INSPECTOR_INTRO])}
          className="ml-auto text-xs text-gray-500 hover:text-gray-300 border border-navy-700 rounded px-3 py-1"
        >
          Restart
        </button>
      </div>

      {/* Quick starters (shown initially) */}
      {messages.length <= 1 && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          {OPENING_STARTERS.map((s, i) => (
            <button
              key={i}
              onClick={() => sendMessage(s)}
              className="text-left text-xs p-3 bg-amber-900/20 border border-amber-800/50 rounded-lg hover:border-amber-700 text-amber-300 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              msg.role === 'user' ? 'bg-teal-700' : 'bg-amber-900/50 border border-amber-800'
            }`}>
              {msg.role === 'user'
                ? <User size={14} className="text-white" />
                : <ClipboardList size={14} className="text-amber-400" />
              }
            </div>
            <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-teal-700 text-white'
                : 'bg-amber-900/20 border border-amber-800/50 text-gray-200'
            }`}>
              {msg.content || (isStreaming && msg.role === 'assistant' && (
                <span className="flex items-center gap-2 text-amber-400">
                  <LoadingSpinner size="sm" />Inspector reviewing...
                </span>
              ))}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-navy-700 pt-4">
        <div className="flex gap-3 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
            placeholder="Respond to the inspector's questions..."
            rows={2}
            disabled={isStreaming}
            className="flex-1 bg-navy-800 border border-navy-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 resize-none focus:outline-none focus:border-amber-600 text-sm disabled:opacity-60"
          />
          <button onClick={() => sendMessage(input)} disabled={!input.trim() || isStreaming}
            className="bg-amber-700 hover:bg-amber-600 text-white p-3 rounded-lg disabled:opacity-50 transition-colors">
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
