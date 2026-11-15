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
import { ChevronDown, Zap } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { complianceApi } from '@/lib/api'
import { MOCK_CII_DATA } from '@/lib/mockData'
import type { CIIData } from '@/lib/types'
import type { CIIRating } from '@/lib/types'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import Badge from '@/components/ui/Badge'
import { getCIIColor } from '@/lib/utils'
import { tok } from '@/lib/theme'

const RATINGS: CIIRating[] = ['A', 'B', 'C', 'D', 'E']

function calcProjectedCII(baseCII: number, speed: number, baseSpeed: number, routeEff: string): number {
  const speedFactor = Math.pow(speed / baseSpeed, 3)
  const effFactor = routeEff === 'optimal' ? 0.93 : routeEff === 'standard' ? 1.0 : 1.07
  return parseFloat((baseCII * speedFactor * effFactor).toFixed(2))
}

export default function CIITracker() {
  const { selectedVessel, vessels } = useFleet()
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
      <div className="card flex items-center justify-center h-64 text-muted">
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
      <div className="card flex items-center justify-center h-64 text-status-red">
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
          <h2 className="text-lg font-semibold text-ink">CII Carbon Intensity Indicator</h2>
          <p className="text-muted text-sm">Real-time carbon intensity monitoring, {ciiData.year}</p>
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
            <div className="absolute right-0 top-full mt-1 bg-paper-2 border border-rule rounded-inner z-10 min-w-[200px]">
              {vessels.map((v) => (
                <button
                  key={v.id}
                  onClick={() => { setLocalVessel(v); setShowVesselDrop(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-ink-2 hover:bg-paper-3 hover:text-ink"
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
            <Badge variant="warning">At Risk</Badge>
          )}
          <div className={`tabular-nums text-8xl font-semibold leading-none ${getCIIColor(rating)}`}>
            {rating}
          </div>
          {/* Rating scale */}
          <div className="flex gap-1.5 mt-2">
            {RATINGS.map((r) => (
              <div
                key={r}
                className={`w-8 h-8 rounded-inner flex items-center justify-center tabular-nums font-semibold text-[13px] transition-colors ${
                  r === rating
                    ? `${getCIIColor(r)} bg-light/5 border border-current`
                    : 'bg-paper-2 border border-light/[0.08] text-faint'
                }`}
              >
                {r}
              </div>
            ))}
          </div>
          <div className="mt-2 text-center border-t border-rule pt-4 w-full">
            <p className="text-[11px] text-faint">Current vs Required</p>
            <p className="tabular-nums text-2xl font-semibold mt-1.5">
              <span className={getCIIColor(rating)}>{ciiData.currentValue.toFixed(2)}</span>
              <span className="text-faint-2 mx-1">/</span>
              <span className="text-status-green">{ciiData.requiredValue.toFixed(2)}</span>
            </p>
          </div>
          {ciiData.daysToRatingChange !== undefined && (
            <div className="mt-2 text-center bg-paper-3/50 rounded-inner px-4 py-2.5">
              <p className="text-xs text-muted">Days until rating change</p>
              <p className="tabular-nums text-2xl font-semibold text-status-amber">{ciiData.daysToRatingChange}</p>
            </div>
          )}
        </div>

        {/* Trajectory chart */}
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-ink mb-4">CII trajectory, 2026</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isAtRisk ? tok('critical') : tok('accent')} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={isAtRisk ? tok('critical') : tok('accent')} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="requiredFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={tok('ink-2')} stopOpacity={0.08} />
                  <stop offset="95%" stopColor={tok('ink-2')} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={tok('light', 0.05)} />
              <XAxis dataKey="month" tick={{ fill: tok('muted'), fontSize: 11 }} />
              <YAxis tick={{ fill: tok('muted'), fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: tok('paper-2'), border: `1px solid ${tok('light', 0.1)}`, borderRadius: '10px', color: tok('ink') }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', color: tok('ink-2') }} />
              <Area
                type="monotone"
                dataKey="Actual CII"
                stroke={isAtRisk ? tok('critical') : tok('accent')}
                strokeWidth={2}
                fill="url(#actualFill)"
              />
              <Area
                type="monotone"
                dataKey="Required CII"
                stroke={tok('ink-2')}
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
          <Zap className="w-5 h-5 text-accent" />
          <h3 className="font-semibold text-ink">What-If Simulator</h3>
          <span className="text-xs text-faint ml-1">Adjust parameters to see projected CII impact</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="flex justify-between text-[11.5px] font-semibold text-ink-2 mb-2">
              <span>Speed</span>
              <span className="text-accent tabular-nums">{speed} kn</span>
            </label>
            <input
              type="range"
              min={10}
              max={15}
              step={0.5}
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="slider-teal w-full cursor-pointer"
              style={{
                background: `linear-gradient(to right, ${tok('accent')} 0%, ${tok('accent')} ${((speed - 10) / 5) * 100}%, ${tok('paper-3')} ${((speed - 10) / 5) * 100}%, ${tok('paper-3')} 100%)`,
              }}
            />
            <div className="flex justify-between text-xs text-faint mt-1 tabular-nums">
              <span>10 kn (Eco)</span>
              <span>15 kn (Fast)</span>
            </div>
          </div>

          <div>
            <label className="block text-[11.5px] font-semibold text-ink-2 mb-2">Route Efficiency</label>
            <select
              value={routeEff}
              onChange={(e) => setRouteEff(e.target.value)}
              className="w-full bg-paper-2 border border-light/[0.1] rounded-inner px-3 py-2 text-ink text-sm"
            >
              <option value="optimal">Optimal (AI-optimized route)</option>
              <option value="standard">Standard (current route)</option>
              <option value="poor">Poor (weather deviations)</option>
            </select>
          </div>

          <div className="border border-rule rounded-inner p-4 flex flex-col justify-center">
            <p className="text-[11.5px] text-faint mb-1">Projected CII Score</p>
            <p className={`tabular-nums text-2xl font-semibold ${projectedCII <= ciiData.requiredValue ? 'text-status-green' : 'text-status-amber'}`}>
              {projectedCII.toFixed(2)}
            </p>
            <p className="text-xs text-muted mt-1">
              {projectedImprovement > 0 ? (
                <span className="text-status-green">-{projectedImprovement.toFixed(2)} improvement vs current</span>
              ) : (
                <span className="text-status-red">+{Math.abs(projectedImprovement).toFixed(2)} worse vs current</span>
              )}
            </p>
            {projectedCII <= ciiData.requiredValue && (
              <Badge variant="healthy" className="mt-2 w-fit">Will meet requirement</Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
