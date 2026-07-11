import { useState, lazy, Suspense } from 'react'
import { Navigation, Loader2, ChevronDown, ChevronUp, Fuel, Clock, Wind } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { voyageApi } from '@/lib/api'
import type { RouteOptimization } from '@/lib/types'
import type { SpeedPreference } from '@/lib/types'
import { cn } from '@/lib/utils'

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
        isAI ? 'border-teal-600' : 'border-navy-700'
      )}
    >
      {isAI && (
        <div className="absolute -top-2.5 left-4">
          <span className="bg-navy-800 border border-teal-600 text-teal-400 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-[2px]">
            AI Recommended
          </span>
        </div>
      )}
      <h3 className={cn('font-semibold mb-4', isAI ? 'text-teal-400' : 'text-gray-300')}>
        {label}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-navy-700/50 rounded-[2px] p-3">
          <p className="text-gray-400 text-xs">Distance</p>
          <p className="text-white font-mono font-semibold text-lg">{data.distance.toLocaleString()} nm</p>
        </div>
        <div className="bg-navy-700/50 rounded-[2px] p-3">
          <p className="text-gray-400 text-xs">Fuel</p>
          <p className="text-white font-mono font-semibold text-lg">{data.fuel.toFixed(1)} MT</p>
        </div>
        <div className="bg-navy-700/50 rounded-[2px] p-3">
          <p className="text-gray-400 text-xs">Fuel Cost</p>
          <p className="text-white font-mono font-semibold text-lg">${data.cost.toLocaleString()}</p>
        </div>
        <div className="bg-navy-700/50 rounded-[2px] p-3">
          <p className="text-gray-400 text-xs">CO2</p>
          <p className="text-white font-mono font-semibold text-lg">{data.co2.toFixed(1)} t</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm text-gray-400">
        <Clock className="w-4 h-4" />
        <span>ETA: <span className="text-white font-mono">{new Date(data.eta).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></span>
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
        <h2 className="text-base font-semibold text-white mb-5 flex items-center gap-2">
          <Navigation className="w-4 h-4 text-teal-400" />
          Route Parameters
        </h2>

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
            <label className="block text-[11.5px] font-semibold tracking-wide text-[#a8adb5] mb-2">Departure Date</label>
            <input
              type="date"
              value={departureDate}
              onChange={(e) => setDepartureDate(e.target.value)}
              className="w-full bg-[#12161a] border border-white/[0.1] rounded-[2px] px-3 py-2.5 text-white focus:outline-none focus:border-teal-600 transition-colors text-sm font-mono"
            />
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
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>0% (Empty)</span>
              <span>100% (Full)</span>
            </div>
          </div>
        </div>

        {/* Speed preference */}
        <div className="mt-6">
          <label className="block text-[11.5px] font-semibold tracking-wide text-[#a8adb5] mb-2.5">Speed Preference</label>
          <div className="grid grid-cols-3 gap-3">
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSpeedPreference(opt.id)}
                className={cn(
                  'flex flex-col gap-1 p-3.5 rounded-[2px] border text-left transition-colors bg-[#12161a]',
                  speedPreference === opt.id ? 'border-teal-600' : 'border-white/[0.1] hover:border-white/20'
                )}
              >
                <span className="text-[13px] font-semibold text-[#e2e4e7]">{opt.label}</span>
                <p className="text-[11.5px] text-[#767d88] mt-1">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 border border-status-red text-status-red rounded-[2px] text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleOptimize}
          disabled={loading || !selectedVessel}
          className="mt-6 w-full py-[13px] flex items-center justify-center gap-2 rounded-[2px] font-semibold bg-teal-900 border border-teal-600/50 text-teal-400 hover:bg-teal-600/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          <p className="text-center text-gray-500 text-xs mt-2">
            Select a vessel from the top bar to enable optimization
          </p>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Savings banner */}
          <div className="flex items-center gap-3 p-4 bg-navy-800 border border-status-green rounded-[2px]">
            <Fuel className="w-5 h-5 text-status-green shrink-0" />
            <p className="text-status-green font-semibold">
              Save <span className="font-mono">${result.aiRoute.costSavings.toLocaleString()}</span> and <span className="font-mono">{result.aiRoute.savings.toFixed(1)} MT</span> fuel with the AI-optimized route
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
              <span className="text-sm font-semibold text-white flex items-center gap-2">
                <span className="w-5 h-5 bg-teal-600/20 rounded-[2px] flex items-center justify-center text-xs text-teal-400">AI</span>
                AI Reasoning
              </span>
              {reasoningOpen ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>
            {reasoningOpen && (
              <div className="mt-4 p-4 bg-navy-700/50 rounded-[2px] border border-navy-600">
                <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                  {result.aiRoute.reasoning}
                </p>
              </div>
            )}
          </div>

          {/* Map */}
          <div className="card p-0 overflow-hidden">
            <div className="p-4 border-b border-navy-700">
              <h3 className="font-semibold text-white text-sm">Route Visualization</h3>
            </div>
            <Suspense fallback={<div className="h-[450px] flex items-center justify-center text-gray-500">Loading map...</div>}>
              <RouteMap routeData={result} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  )
}
