import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Anchor, Trash2 } from 'lucide-react'
import { useFleet } from '../../context/FleetContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { toBackendVesselId } from '../../lib/utils'
import ChatMarkdown from '../../components/ui/ChatMarkdown'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

// Chat history is persisted to localStorage, keyed per vessel, so a conversation
// survives switching tabs/modules (which unmounts this component) and full page
// reloads. Each vessel keeps its own thread since the AI answers with that
// vessel's context loaded.
const STORAGE_PREFIX = 'vm_knowledge_chat_'
const storageKeyFor = (vesselId?: string) => `${STORAGE_PREFIX}${vesselId || 'default'}`

function loadHistory(key: string): Message[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Message[]) : []
  } catch {
    return []
  }
}

const EXAMPLE_PROMPTS = [
  "Main engine won't start — starting air pressure is 28 bar, what should I check?",
  "Turbocharger is vibrating abnormally, what are the possible causes?",
  "Cargo pump cavitating on port tank — troubleshooting steps?",
  "What is the procedure for emergency bilge pumping?",
]

export default function KnowledgeChat() {
  const { selectedVessel } = useFleet()
  const storageKey = storageKeyFor(selectedVessel?.id)
  // Lazy initializer: hydrate from localStorage on first render so the thread is
  // there immediately, before any effect runs.
  const [messages, setMessages] = useState<Message[]>(() => loadHistory(storageKey))
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // When switching vessels we load a new thread; on that same render `messages`
  // still holds the previous vessel's thread, so we skip persisting once to
  // avoid writing thread A under vessel B's key.
  const skipNextSaveRef = useRef(false)

  // Swap to the selected vessel's saved thread whenever the vessel changes.
  useEffect(() => {
    skipNextSaveRef.current = true
    setMessages(loadHistory(storageKey))
  }, [storageKey])

  // Persist on every change (new message, each streamed token, clear).
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages))
    } catch {
      /* localStorage full/unavailable — non-fatal, chat still works in-session */
    }
  }, [messages, storageKey])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const clearChat = () => {
    if (isStreaming) return
    setMessages([])
  }

  const sendMessage = async (content: string) => {
    if (!content.trim() || isStreaming) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content }
    const aiId = Date.now().toString() + '-ai'
    const aiMsg: Message = { id: aiId, role: 'assistant', content: '' }

    setMessages(prev => [...prev, userMsg, aiMsg])
    setInput('')
    setIsStreaming(true)

    try {
      const response = await fetch('/api/knowledge/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('vm_token')}`,
        },
        body: JSON.stringify({
          vesselId: toBackendVesselId(selectedVessel?.id),
          message: content,
          conversationHistory: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(err.error || `Error ${response.status}`)
      }
      if (!response.body) throw new Error('No response body')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        const lines = text.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.text) {
                setMessages(prev =>
                  prev.map(m => m.id === aiId ? { ...m, content: m.content + data.text } : m)
                )
              }
            } catch { /* skip parse errors */ }
          }
        }
      }
    } catch {
      setMessages(prev =>
        prev.map(m =>
          m.id === aiId
            ? { ...m, content: 'Unable to connect to VesselMind AI. Please check your connection and try again.' }
            : m
        )
      )
    } finally {
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ height: 'calc(100vh - 200px)' }}>
      {/* Context banner */}
      <div className="bg-navy-800 border border-teal-600/50 rounded-[2px] p-3 mb-4 flex items-center gap-2">
        <Anchor size={16} className="text-teal-400 shrink-0" />
        <span className="text-sm text-teal-400">
          Vessel context loaded:{' '}
          <span className="font-semibold text-white">
            {selectedVessel?.name || 'MV Merdeka Spirit'}
          </span>{' '}
          — machinery manuals, defect history, and equipment specs available
        </span>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            disabled={isStreaming}
            title="Clear this vessel's saved chat history"
            className="ml-auto shrink-0 flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 size={14} />
            Clear
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12">
            <div className="w-16 h-16 bg-teal-900/50 rounded-full flex items-center justify-center mb-4 border border-teal-700">
              <Bot size={32} className="text-teal-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">VesselMind AI Assistant</h3>
            <p className="text-gray-400 text-center max-w-md mb-8">
              Ask any technical question about your vessel. I have access to equipment manuals,
              defect history, and maritime regulations.
            </p>
            <div className="grid grid-cols-1 gap-3 w-full max-w-2xl">
              {EXAMPLE_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(prompt)}
                  className="text-left p-3 bg-navy-800 border border-navy-700 rounded-[2px] hover:border-teal-600 hover:bg-navy-700 transition-colors text-sm text-gray-300"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                msg.role === 'user' ? 'bg-teal-700' : 'bg-navy-700 border border-navy-600'
              }`}>
                {msg.role === 'user' ? <User size={16} className="text-white" /> : <Bot size={16} className="text-teal-400" />}
              </div>
              <div className={`max-w-[80%] rounded-[2px] px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-teal-700 text-white'
                  : 'bg-navy-800 border border-navy-700 text-gray-200'
              }`}>
                {msg.content ? (
                  msg.role === 'assistant' ? <ChatMarkdown content={msg.content} /> : msg.content
                ) : (
                  isStreaming && msg.role === 'assistant' && (
                    <span className="flex items-center gap-2">
                      <LoadingSpinner size="sm" />
                      <span className="text-gray-400">VesselMind AI is thinking...</span>
                    </span>
                  )
                )}
                {msg.role === 'assistant' && msg.content && isStreaming && messages[messages.length - 1].id === msg.id && (
                  <span className="inline-block w-1 h-4 bg-teal-400 animate-pulse ml-1 align-middle" />
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-navy-700 pt-4">
        <div className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about engine procedures, troubleshooting, safety protocols..."
            rows={2}
            disabled={isStreaming}
            className="flex-1 bg-navy-800 border border-navy-700 rounded-[2px] px-4 py-3 text-white placeholder-gray-500 resize-none focus:outline-none focus:border-teal-600 text-sm disabled:opacity-60"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isStreaming}
            className="btn-primary p-3 rounded-[2px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={18} />
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-2">Press Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
