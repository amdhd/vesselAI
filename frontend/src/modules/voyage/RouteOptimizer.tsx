import { useState, lazy, Suspense } from 'react'
import { Navigation, Loader2, ChevronDown, ChevronUp, Fuel, Clock, Wind } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { voyageApi } from '@/lib/api'
import type { RouteOptimization } from '@/lib/types'
import type { SpeedPreference } from '@/lib/types'
import { cn } from '@/lib/utils'
import { tok } from '@/lib/theme'

const RouteMap = lazy(() => import('./RouteMap'))

const PORTS = [
  'Singapore',
  'Fujairah',
  'Port Dickson',
  'Kerteh',
  'Rotterdam',
  'Ras Tanura',
]

const SPEED_OPTIONS: { id: SpeedPreference; label: string; description: string }[] = [
  { id: 'eco', label: 'Eco', description: 'Minimize fuel & emissions, slower ETA' },
  { id: 'normal', label: 'Normal', description: 'Balanced speed and fuel consumption' },
  { id: 'fast', label: 'Fast', description: 'Fastest arrival, higher fuel cost' },
]

function RouteCard({
  label,
  data,
  isAI,
}: {
  label: string
  data: RouteOptimization['directRoute'] | RouteOptimization['aiRoute']
  isAI?: boolean
}) {
  return (
    <div
      className={cn(
        'card relative',
        isAI ? 'border-accent' : 'border-rule'
      )}
    >
      {isAI && (
        <div className="absolute -top-2.5 left-4">
          <span className="bg-paper-2 border border-accent text-accent text-[11px] font-semibold px-2 py-0.5 rounded-inner">
            AI Recommended
          </span>
        </div>
      )}
      <h3 className={cn('font-semibold mb-4', isAI ? 'text-accent' : 'text-ink-2')}>
        {label}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-paper-3/50 rounded-inner p-3">
          <p className="text-muted text-xs">Distance</p>
          <p className="text-ink tabular-nums font-semibold text-lg">{data.distance.toLocaleString()} nm</p>
        </div>
        <div className="bg-paper-3/50 rounded-inner p-3">
          <p className="text-muted text-xs">Fuel</p>
          <p className="text-ink tabular-nums font-semibold text-lg">{data.fuel.toFixed(1)} MT</p>
        </div>
        <div className="bg-paper-3/50 rounded-inner p-3">
          <p className="text-muted text-xs">Fuel Cost</p>
          <p className="text-ink tabular-nums font-semibold text-lg">${data.cost.toLocaleString()}</p>
        </div>
        <div className="bg-paper-3/50 rounded-inner p-3">
          <p className="text-muted text-xs">CO2</p>
          <p className="text-ink tabular-nums font-semibold text-lg">{data.co2.toFixed(1)} t</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm text-muted">
        <Clock className="w-4 h-4" />
        <span>ETA: <span className="text-ink tabular-nums">{new Date(data.eta).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></span>
      </div>
    </div>
  )
}

export default function RouteOptimizer() {
  const { selectedVessel } = useFleet()
  const [departurePort, setDeparturePort] = useState('Kerteh')
  const [destinationPort, setDestinationPort] = useState('Singapore')
  const [departureDate, setDepartureDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0]
  })
  const [cargoLoad, setCargoLoad] = useState(75)
  const [speedPreference, setSpeedPreference] = useState<SpeedPreference>('eco')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<RouteOptimization | null>(null)
  const [reasoningOpen, setReasoningOpen] = useState(false)

  const handleOptimize = async () => {
    if (!selectedVessel) {
      setError('Please select a vessel first')
      return
    }
    if (departurePort === destinationPort) {
      setError('Departure and destination ports must be different')
      return
    }

    setError('')
    setLoading(true)
    setResult(null)

    try {
      const data = await voyageApi.optimizeRoute({
        vesselId: selectedVessel.id,
        departurePort,
        destinationPort,
        departureDate,
        cargoLoad,
        speedPreference,
      })
      setResult(data)
    } catch {
      setError('Route optimization failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Form */}
      <div className="card">
        <h2 className="text-base font-semibold text-ink mb-5 flex items-center gap-2">
          <Navigation className="w-4 h-4 text-accent" />
          Route Parameters
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11.5px] font-semibold text-ink-2 mb-2">Departure Port</label>
            <select
              value={departurePort}
              onChange={(e) => setDeparturePort(e.target.value)}
              className="w-full bg-paper-2 border border-light/[0.1] rounded-inner px-3 py-2.5 text-ink focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors text-sm"
            >
              {PORTS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11.5px] font-semibold text-ink-2 mb-2">Destination Port</label>
            <select
              value={destinationPort}
              onChange={(e) => setDestinationPort(e.target.value)}
              className="w-full bg-paper-2 border border-light/[0.1] rounded-inner px-3 py-2.5 text-ink focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors text-sm"
            >
              {PORTS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11.5px] font-semibold text-ink-2 mb-2">Departure Date</label>
            <input
              type="date"
              value={departureDate}
              onChange={(e) => setDepartureDate(e.target.value)}
              className="w-full bg-paper-2 border border-light/[0.1] rounded-inner px-3 py-2.5 text-ink focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors text-sm tabular-nums"
            />
          </div>

          <div>
            <label className="flex justify-between items-center text-[11.5px] font-semibold text-ink-2 mb-2">
              <span>Cargo Load</span>
              <span className="text-accent tabular-nums">{cargoLoad}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={cargoLoad}
              onChange={(e) => setCargoLoad(Number(e.target.value))}
              className="slider-teal w-full cursor-pointer"
              style={{
                background: `linear-gradient(to right, ${tok('accent')} 0%, ${tok('accent')} ${cargoLoad}%, ${tok('paper-3')} ${cargoLoad}%, ${tok('paper-3')} 100%)`,
              }}
            />
            <div className="flex justify-between text-xs text-faint mt-1">
              <span>0% (Empty)</span>
              <span>100% (Full)</span>
            </div>
          </div>
        </div>

        {/* Speed preference */}
        <div className="mt-6">
          <label className="block text-[11.5px] font-semibold text-ink-2 mb-2.5">Speed Preference</label>
          <div className="grid grid-cols-3 gap-3">
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSpeedPreference(opt.id)}
                className={cn(
                  'flex flex-col gap-1 p-3.5 rounded-inner border text-left transition-colors bg-paper-2',
                  speedPreference === opt.id ? 'border-accent' : 'border-light/[0.1] hover:border-light/20'
                )}
              >
                <span className="text-[13px] font-semibold text-ink">{opt.label}</span>
                <p className="text-[11.5px] text-muted mt-1">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 border border-status-red text-status-red rounded-inner text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleOptimize}
          disabled={loading || !selectedVessel}
          className="mt-6 w-full py-[13px] flex items-center justify-center gap-2 rounded-inner font-semibold bg-accent/10 border border-accent/50 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing weather conditions and calculating optimal route...
            </>
          ) : (
            <>
              <Wind className="w-4 h-4" />
              Optimize Route with AI
            </>
          )}
        </button>

        {!selectedVessel && (
          <p className="text-center text-faint text-xs mt-2">
            Select a vessel from the top bar to enable optimization
          </p>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Savings banner */}
          <div className="flex items-center gap-3 p-4 bg-status-green/[0.06] border border-status-green/35 rounded-inner">
            <Fuel className="w-5 h-5 text-status-green shrink-0" />
            <p className="text-status-green font-semibold">
              Save <span className="tabular-nums">${result.aiRoute.costSavings.toLocaleString()}</span> and <span className="tabular-nums">{result.aiRoute.savings.toFixed(1)} MT</span> fuel with the AI-optimized route
            </p>
          </div>

          {/* Route comparison cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RouteCard label="Direct Route" data={result.directRoute} />
            <RouteCard label="AI-Optimized Route" data={result.aiRoute} isAI />
          </div>

          {/* AI Reasoning */}
          <div className="card">
            <button
              onClick={() => setReasoningOpen(!reasoningOpen)}
              className="flex items-center justify-between w-full text-left"
            >
              <span className="text-sm font-semibold text-ink flex items-center gap-2">
                <span className="w-5 h-5 bg-accent/20 rounded-inner flex items-center justify-center text-xs text-accent">AI</span>
                AI Reasoning
              </span>
              {reasoningOpen ? (
                <ChevronUp className="w-4 h-4 text-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted" />
              )}
            </button>
            {reasoningOpen && (
              <div className="mt-4 p-4 bg-paper-3/50 rounded-inner border border-rule-2">
                <p className="text-ink-2 text-sm leading-relaxed whitespace-pre-wrap">
                  {result.aiRoute.reasoning}
                </p>
              </div>
            )}
          </div>

          {/* Map */}
          <div className="card p-0 overflow-hidden">
            <div className="p-4 border-b border-rule">
              <h3 className="font-semibold text-ink text-sm">Route Visualization</h3>
            </div>
            <Suspense fallback={<div className="h-[450px] flex items-center justify-center text-faint">Loading map...</div>}>
              <RouteMap routeData={result} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  )
}
