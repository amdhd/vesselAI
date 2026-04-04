import { useState, useEffect } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { AlertTriangle, ChevronDown, Zap } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { complianceApi } from '@/lib/api'
import { MOCK_CII_DATA, MOCK_VESSELS } from '@/lib/mockData'
import type { CIIData } from '@/lib/types'
import type { CIIRating } from '@/lib/types'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { getCIIColor } from '@/lib/utils'

const RATINGS: CIIRating[] = ['A', 'B', 'C', 'D', 'E']

const ratingColors: Record<CIIRating, string> = {
  A: 'bg-green-500',
  B: 'bg-teal-400',
  C: 'bg-yellow-400',
  D: 'bg-amber-500',
  E: 'bg-red-500',
}

const ratingGlowColors: Record<CIIRating, string> = {
  A: 'text-green-400 drop-shadow-[0_0_30px_rgba(34,197,94,0.8)]',
  B: 'text-teal-400 drop-shadow-[0_0_30px_rgba(45,212,191,0.8)]',
  C: 'text-yellow-400 drop-shadow-[0_0_30px_rgba(234,179,8,0.8)]',
  D: 'text-amber-400 drop-shadow-[0_0_30px_rgba(251,146,60,0.8)]',
  E: 'text-red-400 drop-shadow-[0_0_30px_rgba(248,113,113,0.8)]',
}

function calcProjectedCII(baseCII: number, speed: number, baseSpeed: number, routeEff: string): number {
  const speedFactor = Math.pow(speed / baseSpeed, 3)
  const effFactor = routeEff === 'optimal' ? 0.93 : routeEff === 'standard' ? 1.0 : 1.07
  return parseFloat((baseCII * speedFactor * effFactor).toFixed(2))
}

export default function CIITracker() {
  const { selectedVessel } = useFleet()
  const [localVessel, setLocalVessel] = useState(selectedVessel)
  const [ciiData, setCiiData] = useState<CIIData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [speed, setSpeed] = useState(12)
  const [routeEff, setRouteEff] = useState<string>('standard')
  const [showVesselDrop, setShowVesselDrop] = useState(false)

  useEffect(() => {
    if (selectedVessel) setLocalVessel(selectedVessel)
  }, [selectedVessel])

  useEffect(() => {
    if (!localVessel) return
    setIsLoading(true)
    setError(null)

    complianceApi.getCII(localVessel.id).then(setCiiData).catch(() => {
      const mock = MOCK_CII_DATA[localVessel.id]
      if (mock) setCiiData(mock)
      else setError('No CII data available for this vessel.')
    }).finally(() => setIsLoading(false))
  }, [localVessel])

  if (!localVessel) {
    return (
      <div className="card flex items-center justify-center h-64 text-gray-400">
        Select a vessel to view CII data.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="card flex items-center justify-center h-64">
        <LoadingSpinner label="Loading CII data..." />
      </div>
    )
  }

  if (error || !ciiData) {
    return (
      <div className="card flex items-center justify-center h-64 text-red-400">
        {error ?? 'Failed to load CII data.'}
      </div>
    )
  }

  const rating = ciiData.currentRating
  const isAtRisk = rating === 'D' || rating === 'E'
  const baseSpeed = localVessel.position.speed || 12
  const projectedCII = calcProjectedCII(ciiData.currentValue, speed, baseSpeed || 12, routeEff)
  const projectedImprovement = ciiData.currentValue - projectedCII

  const chartData = ciiData.trajectory.map((t) => ({
    month: t.month,
    'Actual CII': parseFloat(t.actual.toFixed(2)),
    'Required CII': parseFloat(t.required.toFixed(2)),
  }))

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">CII Carbon Intensity Indicator</h2>
          <p className="text-gray-400 text-sm">Real-time carbon intensity monitoring — {ciiData.year}</p>
        </div>
        {/* Vessel selector */}
        <div className="relative">
          <button
            onClick={() => setShowVesselDrop(!showVesselDrop)}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            {localVessel.name}
            <ChevronDown className="w-4 h-4" />
          </button>
          {showVesselDrop && (
            <div className="absolute right-0 top-full mt-1 bg-navy-800 border border-navy-700 rounded-lg shadow-xl z-10 min-w-[200px]">
              {MOCK_VESSELS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => { setLocalVessel(v); setShowVesselDrop(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-navy-700 hover:text-white first:rounded-t-lg last:rounded-b-lg"
                >
                  {v.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Big rating display */}
        <div className="card flex flex-col items-center justify-center gap-4 py-8">
          {isAtRisk && (
            <div className="flex items-center gap-2 animate-pulse">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <span className="text-red-400 font-bold text-sm tracking-widest uppercase">At Risk</span>
            </div>
          )}
          <div className={`text-9xl font-black leading-none ${ratingGlowColors[rating]}`}>
            {rating}
          </div>
          {/* Rating scale */}
          <div className="flex gap-2 mt-2">
            {RATINGS.map((r) => (
              <div
                key={r}
                className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm transition-all ${
                  r === rating
                    ? `${ratingColors[r]} text-white scale-110 shadow-lg`
                    : 'bg-navy-700 text-gray-500'
                }`}
              >
                {r}
              </div>
            ))}
          </div>
          <div className="mt-2 text-center">
            <p className="text-xs text-gray-400">Current vs Required</p>
            <p className="text-white font-semibold mt-1">
              <span className={getCIIColor(rating)}>{ciiData.currentValue.toFixed(2)}</span>
              <span className="text-gray-500 mx-1">|</span>
              <span className="text-green-400">{ciiData.requiredValue.toFixed(2)}</span>
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Actual | Required</p>
          </div>
          {ciiData.daysToRatingChange !== undefined && (
            <div className="mt-2 text-center bg-navy-700 rounded-lg px-4 py-2">
              <p className="text-xs text-gray-400">Days until rating change</p>
              <p className="text-2xl font-bold text-amber-400">{ciiData.daysToRatingChange}</p>
            </div>
          )}
        </div>

        {/* Trajectory chart */}
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-white mb-4">CII Trajectory — 2026</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isAtRisk ? '#ef4444' : '#14b8a6'} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={isAtRisk ? '#ef4444' : '#14b8a6'} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="requiredFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3a6e" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#112654', border: '1px solid #1e3a6e', borderRadius: '8px', color: '#fff' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }} />
              <Area
                type="monotone"
                dataKey="Actual CII"
                stroke={isAtRisk ? '#ef4444' : '#14b8a6'}
                strokeWidth={2}
                fill="url(#actualFill)"
              />
              <Area
                type="monotone"
                dataKey="Required CII"
                stroke="#22c55e"
                strokeWidth={2}
                strokeDasharray="5 5"
                fill="url(#requiredFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* What-If Simulator */}
      <div className="card">
        <div className="flex items-center gap-2 mb-5">
          <Zap className="w-5 h-5 text-teal-400" />
          <h3 className="font-semibold text-white">What-If Simulator</h3>
          <span className="text-xs text-gray-500 ml-1">Adjust parameters to see projected CII impact</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Speed: <span className="text-white font-semibold">{speed} kn</span>
            </label>
            <input
              type="range"
              min={10}
              max={15}
              step={0.5}
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-full accent-teal-500"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>10 kn (Eco)</span>
              <span>15 kn (Fast)</span>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Route Efficiency</label>
            <select
              value={routeEff}
              onChange={(e) => setRouteEff(e.target.value)}
              className="w-full bg-navy-700 border border-navy-600 rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="optimal">Optimal (AI-optimized route)</option>
              <option value="standard">Standard (current route)</option>
              <option value="poor">Poor (weather deviations)</option>
            </select>
          </div>

          <div className="bg-navy-700 rounded-xl p-4 flex flex-col justify-center">
            <p className="text-xs text-gray-400 mb-1">Projected CII Score</p>
            <p className={`text-3xl font-bold ${projectedCII <= ciiData.requiredValue ? 'text-green-400' : 'text-amber-400'}`}>
              {projectedCII.toFixed(2)}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {projectedImprovement > 0 ? (
                <span className="text-green-400">-{projectedImprovement.toFixed(2)} improvement vs current</span>
              ) : (
                <span className="text-red-400">+{Math.abs(projectedImprovement).toFixed(2)} worse vs current</span>
              )}
            </p>
            {projectedCII <= ciiData.requiredValue && (
              <span className="mt-2 badge-healthy inline-block w-fit">Will meet requirement</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
