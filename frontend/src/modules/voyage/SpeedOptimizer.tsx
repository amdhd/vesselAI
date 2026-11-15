import { useState, useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Gauge, DollarSign, Wind, Leaf } from 'lucide-react'
import type { SpeedFuelData } from '@/lib/types'
import { tok } from '@/lib/theme'

// Cubic propulsion physics: fuel ∝ speed^3
// Coefficients calibrated for typical VLCC/tanker
const A = 0.065

function calcFuelPerDay(speed: number): number {
  return parseFloat((A * Math.pow(speed, 3)).toFixed(2))
}

function generateCurveData(): SpeedFuelData[] {
  const points: SpeedFuelData[] = []
  for (let s = 8; s <= 18; s += 0.5) {
    points.push({
      speed: s,
      fuelPerDay: calcFuelPerDay(s),
      voyageCost: 0, // populated dynamically
    })
  }
  return points
}

const OPTIMAL_SPEED = 13.5

interface StatItemProps {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  highlight?: boolean
}

function StatItem({ icon, label, value, sub, highlight }: StatItemProps) {
  return (
    <div className={`bg-paper-3/50 rounded-inner p-4 ${highlight ? 'border border-accent-hi/50' : 'border border-rule-2/50'}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-muted text-xs font-medium">{label}</span>
      </div>
      <p className={`tabular-nums text-xl font-semibold ${highlight ? 'text-accent' : 'text-ink'}`}>{value}</p>
      {sub && <p className="text-faint text-xs mt-0.5">{sub}</p>}
    </div>
  )
}

export default function SpeedOptimizer() {
  const [selectedSpeed, setSelectedSpeed] = useState(12)
  const [fuelPrice, setFuelPrice] = useState(650)
  const [voyageDistance, setVoyageDistance] = useState(1500)

  const curveData = useMemo(() => generateCurveData(), [])

  const dailyFuel = useMemo(() => calcFuelPerDay(selectedSpeed), [selectedSpeed])
  const optimalFuel = useMemo(() => calcFuelPerDay(OPTIMAL_SPEED), [])

  const voyageDays = useMemo(() => voyageDistance / (selectedSpeed * 24), [voyageDistance, selectedSpeed])
  const voyageFuel = useMemo(() => dailyFuel * voyageDays, [dailyFuel, voyageDays])
  const voyageCost = useMemo(() => voyageFuel * fuelPrice, [voyageFuel, fuelPrice])
  const co2 = useMemo(() => voyageFuel * 3.114, [voyageFuel])

  const optimalDays = useMemo(() => voyageDistance / (OPTIMAL_SPEED * 24), [voyageDistance])
  const optimalVoyageFuel = useMemo(() => optimalFuel * optimalDays, [optimalFuel, optimalDays])
  const optimalCost = useMemo(() => optimalVoyageFuel * fuelPrice, [optimalVoyageFuel, fuelPrice])
  const costDiff = useMemo(() => voyageCost - optimalCost, [voyageCost, optimalCost])

  const chartDataWithSelected = useMemo(() => {
    return curveData.map((d) => ({
      ...d,
      selected: d.speed === Math.round(selectedSpeed * 2) / 2 ? d.fuelPerDay : undefined,
    }))
  }, [curveData, selectedSpeed])

  return (
    <div className="space-y-5">
      {/* Chart */}
      <div className="card">
        <h2 className="text-base font-semibold text-ink mb-5 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-accent" />
          Speed vs Fuel Consumption Curve
        </h2>

        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartDataWithSelected} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid stroke={tok('light', 0.05)} />
              <XAxis
                dataKey="speed"
                stroke={tok('rule')}
                tick={{ fill: tok('muted'), fontSize: 11 }}
                label={{ value: 'Speed (kn)', position: 'insideBottom', offset: -2, fill: tok('muted'), fontSize: 11 }}
              />
              <YAxis
                stroke={tok('rule')}
                tick={{ fill: tok('muted'), fontSize: 11 }}
                label={{ value: 'Fuel (MT/day)', angle: -90, position: 'insideLeft', fill: tok('muted'), fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: tok('paper-2'), border: `1px solid ${tok('light', 0.1)}`, borderRadius: '10px', fontSize: '12px' }}
                labelStyle={{ color: tok('ink-2') }}
                formatter={(value: number) => [`${value.toFixed(1)} MT/day`, 'Fuel']}
                labelFormatter={(label) => `Speed: ${label} kn`}
              />
              <Legend wrapperStyle={{ fontSize: '12px', color: tok('ink-2') }} />
              <ReferenceLine
                x={OPTIMAL_SPEED}
                stroke={tok('accent')}
                strokeDasharray="4 4"
                label={{ value: `Optimal ${OPTIMAL_SPEED} kn`, position: 'top', fill: tok('accent'), fontSize: 11 }}
              />
              <ReferenceLine
                x={selectedSpeed}
                stroke={tok('apricot')}
                strokeWidth={1.5}
                label={{ value: `Current ${selectedSpeed} kn`, position: 'insideTopRight', fill: tok('apricot'), fontSize: 10 }}
              />
              <Line
                type="monotone"
                dataKey="fuelPerDay"
                stroke={tok('accent')}
                strokeWidth={2}
                dot={false}
                name="Fuel Consumption"
                activeDot={{ r: 4, fill: tok('accent') }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Controls + Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Speed slider + inputs */}
        <div className="card space-y-5">
          <h3 className="font-semibold text-ink text-sm">Voyage Parameters</h3>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-ink-2 text-sm font-medium">Current Speed</label>
              <span className="text-accent tabular-nums font-semibold text-lg">{selectedSpeed} kn</span>
            </div>
            <input
              type="range"
              min={8}
              max={18}
              step={0.5}
              value={selectedSpeed}
              onChange={(e) => setSelectedSpeed(Number(e.target.value))}
              className="w-full h-2 bg-rule rounded-inner appearance-none cursor-pointer accent-accent"
            />
            <div className="flex justify-between text-xs text-faint mt-1 tabular-nums">
              <span>8 kn (min)</span>
              <span className="text-accent">13.5 kn (optimal)</span>
              <span>18 kn (max)</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">
              Fuel Price ($/MT)
            </label>
            <input
              type="number"
              value={fuelPrice}
              onChange={(e) => setFuelPrice(Number(e.target.value))}
              min={300}
              max={1200}
              className="w-full bg-paper-2 border border-light/[0.1] rounded-inner px-3 py-2 text-ink text-sm tabular-nums focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">
              Voyage Distance (nm)
            </label>
            <input
              type="number"
              value={voyageDistance}
              onChange={(e) => setVoyageDistance(Number(e.target.value))}
              min={100}
              max={15000}
              className="w-full bg-paper-2 border border-light/[0.1] rounded-inner px-3 py-2 text-ink text-sm tabular-nums focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors"
            />
          </div>

          <div className="p-3 bg-accent/[0.06] border border-accent/30 rounded-inner text-xs text-accent">
            Recommended speed: <strong className="tabular-nums">{OPTIMAL_SPEED} kn</strong>, best fuel economy for this vessel class
          </div>
        </div>

        {/* Results */}
        <div className="card">
          <h3 className="font-semibold text-ink text-sm mb-4">Voyage Calculations @ {selectedSpeed} kn</h3>
          <div className="grid grid-cols-2 gap-3">
            <StatItem
              icon={<Wind className="w-4 h-4 text-accent" />}
              label="Daily Fuel Burn"
              value={`${dailyFuel.toFixed(1)} MT`}
              sub="at selected speed"
            />
            <StatItem
              icon={<DollarSign className="w-4 h-4 text-status-green" />}
              label="Voyage Fuel Cost"
              value={`$${Math.round(voyageCost).toLocaleString()}`}
              sub={`${voyageFuel.toFixed(0)} MT total`}
            />
            <StatItem
              icon={<Leaf className="w-4 h-4 text-accent" />}
              label="Estimated CO2"
              value={`${co2.toFixed(1)} t`}
              sub="VLSFO factor 3.114"
            />
            <StatItem
              icon={<Gauge className="w-4 h-4 text-status-amber" />}
              label="Voyage Duration"
              value={`${voyageDays.toFixed(1)} days`}
              sub={`${Math.round(voyageDays * 24)} hours`}
            />
          </div>

          <div className="mt-4 p-3 rounded-inner border border-rule-2 bg-paper-3/30">
            <p className="text-xs text-muted mb-1">vs Optimal Speed ({OPTIMAL_SPEED} kn)</p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-2">Cost difference</span>
              <span className={`tabular-nums font-semibold text-sm ${costDiff > 0 ? 'text-status-red' : 'text-status-green'}`}>
                {costDiff > 0 ? '+' : ''}${Math.round(costDiff).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-sm text-ink-2">Fuel difference</span>
              <span className={`tabular-nums font-semibold text-sm ${voyageFuel > optimalVoyageFuel ? 'text-status-red' : 'text-status-green'}`}>
                {voyageFuel > optimalVoyageFuel ? '+' : ''}{(voyageFuel - optimalVoyageFuel).toFixed(1)} MT
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
