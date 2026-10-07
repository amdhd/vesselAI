import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Loader2, Trash2, Square } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { sireApi, type ChatStreamChunk } from '@/lib/api'
import { toBackendVesselId } from '@/lib/utils'
import ChatMarkdown from '@/components/ui/ChatMarkdown'
import AiFallbackNotice from '@/components/ui/AiFallbackNotice'
import { usePersistentVesselState } from '@/hooks/usePersistentVesselState'
import { readSseStream } from '@/lib/sse'
import { describeApiError } from '@/lib/apiError'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  // Set when the server substituted this text after an upstream AI failure,
  // so the bubble can say so instead of passing it off as an answer.
  fallback?: { rateLimited?: boolean; retryAfter?: number }
}

const EXAMPLE_QUESTIONS = [
  "What's our CII forecast for next quarter?",
  'How many ETS allowances do we need before December?',
  'What speed reduction moves MT Kerteh from D to C?',
  'Are we compliant with FuelEU Maritime 2025?',
]

export default function ComplianceChat() {
  const { selectedVessel } = useFleet()
  // Thread is persisted per vessel so it survives tab/module switches and
  // reloads (see the hook for the full rationale).
  const [messages, setMessages] = usePersistentVesselState<ChatMessage[]>(
    'vm_compliance_chat_',
    selectedVessel?.id,
    [],
  )
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Cancels the in-flight request, which also closes the server-side stream
  // rather than leaving it generating tokens nobody will read.
  const abortRef = useRef<AbortController | null>(null)

  const stopStreaming = () => abortRef.current?.abort()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const clearChat = () => {
    if (isStreaming) return
    setMessages([])
  }

  const sendMessage = async (content: string) => {
    if (!content.trim() || isStreaming) return

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content }
    const aiMsgId = Date.now().toString() + '-ai'
    const aiMsg: ChatMessage = { id: aiMsgId, role: 'assistant', content: '' }

    setMessages((prev) => [...prev, userMsg, aiMsg])
    setIsStreaming(true)
    setInput('')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await sireApi.complianceChatStream({
        vesselId: toBackendVesselId(selectedVessel?.id),
        message: content,
        conversationHistory: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        signal: controller.signal,
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: null }))
        throw new Error(err.error || `The compliance AI returned ${response.status}.`)
      }

      await readSseStream<ChatStreamChunk>(response, (chunk) => {
        if (chunk.aiFallback) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? { ...m, content: chunk.text ?? '', fallback: { rateLimited: chunk.rateLimited, retryAfter: chunk.retryAfter } }
                : m,
            ),
          )
          return
        }
        if (chunk.text) {
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, content: m.content + chunk.text } : m)),
          )
        }
      })
    } catch (err) {
      if (!controller.signal.aborted) {
        const reason = describeApiError(err, 'Unable to reach the compliance AI service. Please check your connection and try again.')
        setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? { ...m, content: reason } : m)))
      }
    } finally {
      abortRef.current = null
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(input)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] min-h-[500px]">
      {/* Context banner */}
      <div className="flex items-center gap-2 bg-navy-800 border border-teal-600/50 rounded-[2px] px-4 py-2.5 mb-4 flex-shrink-0">
        <Bot className="w-4 h-4 text-teal-400 flex-shrink-0" />
        <span className="text-sm text-teal-300">
          Context: <span className="font-semibold">{selectedVessel?.name ?? 'All Vessels'}</span> — CII, EU ETS, MARPOL, FuelEU Maritime regulations
        </span>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            disabled={isStreaming}
            title="Clear this vessel's saved chat history"
            className="ml-auto flex-shrink-0 flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-8">
            <div className="text-center">
              <Bot className="w-12 h-12 text-teal-400 mx-auto mb-3" />
              <h3 className="text-white font-semibold text-lg">Compliance AI Assistant</h3>
              <p className="text-gray-400 text-sm mt-1">
                Ask me anything about CII, EU ETS, MARPOL, or maritime regulations
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => void sendMessage(q)}
                  className="text-left text-sm text-gray-300 bg-navy-800 hover:bg-navy-700 border border-navy-700 hover:border-teal-700 rounded-[2px] px-4 py-3 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                msg.role === 'user' ? 'bg-navy-600' : 'bg-teal-900'
              }`}
            >
              {msg.role === 'user' ? (
                <User className="w-4 h-4 text-gray-300" />
              ) : (
                <Bot className="w-4 h-4 text-teal-400" />
              )}
            </div>
            <div
              className={`max-w-[75%] rounded-[2px] px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-navy-700 text-white'
                  : 'bg-navy-800 border border-navy-700 text-gray-200'
              }`}
            >
              {msg.fallback && <AiFallbackNotice {...msg.fallback} />}
              {msg.content ? (
                msg.role === 'assistant' ? <ChatMarkdown content={msg.content} /> : msg.content
              ) : (
                <span className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Thinking...
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 bg-navy-800 border border-navy-700 rounded-[2px] p-3 flex items-end gap-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about CII forecasts, ETS allowances, MARPOL compliance..."
          rows={1}
          disabled={isStreaming}
          className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 resize-none focus:outline-none leading-relaxed"
          style={{ maxHeight: '120px' }}
        />
        {isStreaming && (
          <button
            onClick={stopStreaming}
            title="Stop generating"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-status-red pb-1 transition-colors flex-shrink-0"
          >
            <Square className="w-3 h-3 fill-current" />
            Stop
          </button>
        )}
        <button
          onClick={() => void sendMessage(input)}
          disabled={!input.trim() || isStreaming}
          className="bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white p-2 rounded-[2px] transition-colors flex-shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
