import { useState, useRef, useEffect } from 'react'
import { Bot, Loader2, Wrench, Sparkles, AlertTriangle } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { voyageApi, type AgentPlanResult, type AgentToolCall } from '@/lib/api'
import { cn } from '@/lib/utils'
import ChatMarkdown from '@/components/ui/ChatMarkdown'

const PORTS = ['Singapore', 'Fujairah', 'Port Klang', 'Kerteh', 'Rotterdam', 'Ras Tanura', 'Bintulu']

type SpeedPref = 'eco' | 'normal' | 'fast'

// The planner's inputs + last recommendation are persisted per vessel to
// localStorage, so switching Voyage tabs (which unmounts this component) or a
// full reload doesn't lose the agent's result. Transient run state (loading,
// live stream, errors) is intentionally not persisted.
interface AgentSnapshot {
  departurePort: string
  destinationPort: string
  cargoLoad: number
  speedPreference: SpeedPref
  result: AgentPlanResult | null
}

const STORAGE_PREFIX = 'vm_voyage_agent_'
const storageKeyFor = (vesselId?: string) => `${STORAGE_PREFIX}${vesselId || 'default'}`

function loadSnapshot(key: string): AgentSnapshot | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as AgentSnapshot) : null
  } catch {
    return null
  }
}

const SPEED_OPTIONS = [
  { id: 'eco', label: 'Eco' },
  { id: 'normal', label: 'Normal' },
  { id: 'fast', label: 'Fast' },
] as const

// Tools the agent can call — used to label each step in the trace.
const TOOL_LABELS: Record<string, string> = {
  get_vessel_specs: 'Read vessel specs',
  get_route_info: 'Get route + distance',
  get_marine_weather: 'Fetch live marine weather',
  compute_fuel: 'Compute fuel / cost / CO₂',
}

// "fuelTonnesPerDay" -> "Fuel tonnes per day"
function humanizeKey(k: string): string {
  const spaced = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return String(v)
}

// Renders a tool's input/output as clean labeled rows instead of raw JSON.
function DataView({ data }: { data: unknown }) {
  if (data === null || typeof data !== 'object') {
    return <span className="text-[12px] font-mono text-[#e2e4e7]">{formatValue(data)}</span>
  }
  const entries = Object.entries(data as Record<string, unknown>)
  if (entries.length === 0) {
    return <span className="text-[11.5px] text-[#5c6470] italic">no arguments</span>
  }
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => {
        const nested = v !== null && typeof v === 'object'
        if (nested) {
          return (
            <div key={k}>
              <p className="text-[11px] text-[#767d88] mb-1">{humanizeKey(k)}</p>
              <div className="ml-1 pl-3 border-l border-navy-700">
                <DataView data={v} />
              </div>
            </div>
          )
        }
        return (
          <div key={k} className="flex items-baseline justify-between gap-4">
            <span className="text-[11.5px] text-[#767d88] shrink-0">{humanizeKey(k)}</span>
            <span className="text-[12.5px] font-mono text-[#e2e4e7] text-right break-all">{formatValue(v)}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function AgentPlanner() {
  const { selectedVessel } = useFleet()
  const storageKey = storageKeyFor(selectedVessel?.id)
  // Lazy initializers hydrate the inputs + last result from localStorage on mount.
  const [departurePort, setDeparturePort] = useState(() => loadSnapshot(storageKey)?.departurePort ?? 'Kerteh')
  const [destinationPort, setDestinationPort] = useState(() => loadSnapshot(storageKey)?.destinationPort ?? 'Singapore')
  const [cargoLoad, setCargoLoad] = useState(() => loadSnapshot(storageKey)?.cargoLoad ?? 75)
  const [speedPreference, setSpeedPreference] = useState<SpeedPref>(() => loadSnapshot(storageKey)?.speedPreference ?? 'eco')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AgentPlanResult | null>(() => loadSnapshot(storageKey)?.result ?? null)
  // Tool calls accumulated live from the SSE stream, plus the current step tick.
  const [streamedCalls, setStreamedCalls] = useState<AgentToolCall[]>([])
  const [activeStep, setActiveStep] = useState(0)
  // Skip one save right after a vessel switch reloads that vessel's snapshot.
  const skipNextSaveRef = useRef(false)

  // Reload the selected vessel's saved inputs + result whenever the vessel changes.
  useEffect(() => {
    skipNextSaveRef.current = true
    const snap = loadSnapshot(storageKey)
    setDeparturePort(snap?.departurePort ?? 'Kerteh')
    setDestinationPort(snap?.destinationPort ?? 'Singapore')
    setCargoLoad(snap?.cargoLoad ?? 75)
    setSpeedPreference(snap?.speedPreference ?? 'eco')
    setResult(snap?.result ?? null)
    setStreamedCalls([])
    setError('')
  }, [storageKey])

  // Persist inputs + the final recommendation on change.
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ departurePort, destinationPort, cargoLoad, speedPreference, result }),
      )
    } catch {
      /* localStorage full/unavailable — non-fatal */
    }
  }, [departurePort, destinationPort, cargoLoad, speedPreference, result, storageKey])

  const handleRun = async () => {
    if (!selectedVessel) {
      setError('Select a vessel from the top bar first')
      return
    }
    if (departurePort === destinationPort) {
      setError('Departure and destination must differ')
      return
    }
    setError('')
    setLoading(true)
    setResult(null)
    setStreamedCalls([])
    setActiveStep(0)

    try {
      const res = await voyageApi.agentPlanStream({
        vesselId: selectedVessel.id,
        departurePort,
        destinationPort,
        cargoLoad,
        speedPreference,
      })
      if (!res.ok || !res.body) {
        throw new Error(`stream failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // Parse SSE frames: each is "data: <json>\n\n"; "[DONE]" ends the stream.
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let sep: number
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep).trim()
          buffer = buffer.slice(sep + 2)
          if (!frame.startsWith('data:')) continue
          const payload = frame.slice(5).trim()
          if (payload === '[DONE]') continue

          const ev = JSON.parse(payload) as
            | { type: 'model'; step: number }
            | ({ type: 'tool' } & AgentToolCall)
            | ({ type: 'done' } & AgentPlanResult)
            | { type: 'error'; error: string }

          if (ev.type === 'model') {
            setActiveStep(ev.step)
          } else if (ev.type === 'tool') {
            setStreamedCalls((prev) => [...prev, { tool: ev.tool, input: ev.input, output: ev.output }])
          } else if (ev.type === 'done') {
            setResult(ev)
          } else if (ev.type === 'error') {
            setError(ev.error)
          }
        }
      }
    } catch {
      setError('The agent request failed. Is the backend running?')
    } finally {
      setLoading(false)
      setActiveStep(0)
    }
  }

  // During the run, render the tools streamed so far; once done, the authoritative
  // trace from the final event (identical data, reconciled).
  const traceCalls: AgentToolCall[] = result ? result.toolCalls : streamedCalls

  return (
    <div className="space-y-5">
      {/* Form */}
      <div className="card">
        <h2 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
          <Bot className="w-4 h-4 text-teal-400" />
          AI Voyage Agent
        </h2>
        <p className="text-[#767d88] text-xs mb-5">
          A multi-step agent: it reads the vessel, computes the route, fetches{' '}
          <span className="text-teal-400">live marine weather</span>, and runs the fuel model — then recommends a speed.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11.5px] font-semibold tracking-wide text-[#a8adb5] mb-2">Departure Port</label>
            <select
              value={departurePort}
              onChange={(e) => setDeparturePort(e.target.value)}
              className="w-full bg-[#12161a] border border-white/[0.1] rounded-[2px] px-3 py-2.5 text-white focus:outline-none focus:border-teal-600 transition-colors text-sm"
            >
              {PORTS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11.5px] font-semibold tracking-wide text-[#a8adb5] mb-2">Destination Port</label>
            <select
              value={destinationPort}
              onChange={(e) => setDestinationPort(e.target.value)}
              className="w-full bg-[#12161a] border border-white/[0.1] rounded-[2px] px-3 py-2.5 text-white focus:outline-none focus:border-teal-600 transition-colors text-sm"
            >
              {PORTS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex justify-between items-center text-[11.5px] font-semibold tracking-wide text-[#a8adb5] mb-2">
              <span>Cargo Load</span>
              <span className="text-teal-400 font-mono">{cargoLoad}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={cargoLoad}
              onChange={(e) => setCargoLoad(Number(e.target.value))}
              className="slider-teal w-full cursor-pointer"
              style={{
                background: `linear-gradient(to right, #3a8c85 0%, #3a8c85 ${cargoLoad}%, #1f2227 ${cargoLoad}%, #1f2227 100%)`,
              }}
            />
          </div>
          <div>
            <label className="block text-[11.5px] font-semibold tracking-wide text-[#a8adb5] mb-2">Speed Preference</label>
            <div className="grid grid-cols-3 gap-2">
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setSpeedPreference(opt.id)}
                  className={cn(
                    'py-2.5 rounded-[2px] border text-[13px] font-semibold transition-colors bg-[#12161a]',
                    speedPreference === opt.id ? 'border-teal-600 text-teal-400' : 'border-white/[0.1] text-[#a8adb5] hover:border-white/20'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 border border-status-red text-status-red rounded-[2px] text-sm">{error}</div>
        )}

        <button
          onClick={handleRun}
          disabled={loading || !selectedVessel}
          className="mt-6 w-full py-[13px] flex items-center justify-center gap-2 rounded-[2px] font-semibold bg-teal-900 border border-teal-600/50 text-teal-400 hover:bg-teal-600/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Agent is reasoning — reading specs, weather, and running the fuel model...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Plan Voyage with AI Agent
            </>
          )}
        </button>
      </div>

      {/* Recommendation — appears once the agent converges */}
      {result && (
        <div className="card border-teal-600/60">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-teal-400 flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> Agent Recommendation
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[#5c6470] border border-navy-600 px-2 py-0.5 rounded-[2px]">
                {result.steps} step{result.steps !== 1 ? 's' : ''} · {result.toolCalls.length} tool calls
              </span>
              {result.fallback && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-status-amber border border-status-amber/50 px-2 py-0.5 rounded-[2px] flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Fallback
                </span>
              )}
            </div>
          </div>
          <div className="text-[#e2e4e7] text-sm leading-relaxed">
            <ChatMarkdown content={result.recommendation} />
          </div>
        </div>
      )}

      {/* Reasoning trace — streams in live, then persists after the run */}
      {(traceCalls.length > 0 || loading) && (
        <div className="card">
          <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
            <Wrench className="w-4 h-4 text-gray-400" /> Reasoning trace — tools the agent called
          </h3>
          <ol className="space-y-3">
            {traceCalls.map((call, i) => (
              <li key={i} className="border border-navy-700 rounded-[2px] overflow-hidden animate-in fade-in duration-300">
                <div className="flex items-center gap-2 px-3 py-2 bg-navy-700/40 border-b border-navy-700">
                  <span className="w-5 h-5 shrink-0 bg-teal-600/20 rounded-[2px] flex items-center justify-center text-[11px] font-mono text-teal-400">
                    {i + 1}
                  </span>
                  <span className="text-[13px] font-semibold text-[#e2e4e7]">{TOOL_LABELS[call.tool] ?? call.tool}</span>
                  <span className="text-[11px] font-mono text-[#5c6470]">{call.tool}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-navy-700">
                  <div className="p-3.5">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[#5c6470] mb-2">Input</p>
                    <DataView data={call.input} />
                  </div>
                  <div className="p-3.5">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[#5c6470] mb-2">Output</p>
                    <DataView data={call.output} />
                  </div>
                </div>
              </li>
            ))}

            {/* Live "the agent is working" tick while streaming, before the result lands */}
            {loading && !result && (
              <li className="flex items-center gap-2 px-3 py-2.5 text-[12.5px] text-[#767d88]">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
                {activeStep > 0
                  ? `Reasoning — step ${activeStep}${traceCalls.length > 0 ? ` · ${traceCalls.length} tool call${traceCalls.length !== 1 ? 's' : ''} so far` : ''}…`
                  : 'Starting the agent…'}
              </li>
            )}
          </ol>
        </div>
      )}
    </div>
  )
}
