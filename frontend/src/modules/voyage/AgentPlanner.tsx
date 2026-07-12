import { useState } from 'react'
import { Bot, Loader2, Wrench, Sparkles, AlertTriangle } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { voyageApi, type AgentPlanResult } from '@/lib/api'
import { cn } from '@/lib/utils'
import ChatMarkdown from '@/components/ui/ChatMarkdown'

const PORTS = ['Singapore', 'Fujairah', 'Port Klang', 'Kerteh', 'Rotterdam', 'Ras Tanura', 'Bintulu']

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

export default function AgentPlanner() {
  const { selectedVessel } = useFleet()
  const [departurePort, setDeparturePort] = useState('Kerteh')
  const [destinationPort, setDestinationPort] = useState('Singapore')
  const [cargoLoad, setCargoLoad] = useState(75)
  const [speedPreference, setSpeedPreference] = useState<'eco' | 'normal' | 'fast'>('eco')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AgentPlanResult | null>(null)

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
    try {
      const plan = await voyageApi.agentPlan({
        vesselId: selectedVessel.id,
        departurePort,
        destinationPort,
        cargoLoad,
        speedPreference,
      })
      setResult(plan)
    } catch {
      setError('The agent request failed. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

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

      {/* Result */}
      {result && (
        <div className="space-y-4">
          {/* Recommendation */}
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

          {/* Tool-call trace */}
          <div className="card">
            <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-gray-400" /> Reasoning trace — tools the agent called
            </h3>
            <ol className="space-y-3">
              {result.toolCalls.map((call, i) => (
                <li key={i} className="border border-navy-700 rounded-[2px] overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-navy-700/40 border-b border-navy-700">
                    <span className="w-5 h-5 shrink-0 bg-teal-600/20 rounded-[2px] flex items-center justify-center text-[11px] font-mono text-teal-400">
                      {i + 1}
                    </span>
                    <span className="text-[13px] font-semibold text-[#e2e4e7]">{TOOL_LABELS[call.tool] ?? call.tool}</span>
                    <span className="text-[11px] font-mono text-[#5c6470]">{call.tool}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-navy-700">
                    <div className="p-3">
                      <p className="text-[10px] uppercase tracking-wide text-[#5c6470] mb-1">Input</p>
                      <pre className="text-[11px] text-[#a8adb5] font-mono whitespace-pre-wrap break-words">
                        {JSON.stringify(call.input, null, 2)}
                      </pre>
                    </div>
                    <div className="p-3">
                      <p className="text-[10px] uppercase tracking-wide text-[#5c6470] mb-1">Output</p>
                      <pre className="text-[11px] text-[#a8adb5] font-mono whitespace-pre-wrap break-words">
                        {JSON.stringify(call.output, null, 2)}
                      </pre>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  )
}
