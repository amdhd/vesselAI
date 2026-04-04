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
    <div className={`bg-navy-700/50 rounded-lg p-4 ${highlight ? 'border border-teal-700/50' : 'border border-navy-600/50'}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-gray-400 text-xs font-medium">{label}</span>
      </div>
      <p className={`text-xl font-bold ${highlight ? 'text-teal-400' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
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
        <h2 className="text-base font-semibold text-white mb-5 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-teal-400" />
          Speed vs Fuel Consumption Curve
        </h2>

        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartDataWithSelected} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3a6e" />
              <XAxis
                dataKey="speed"
                stroke="#4b6cb7"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                label={{ value: 'Speed (kn)', position: 'insideBottom', offset: -2, fill: '#6b7280', fontSize: 11 }}
              />
              <YAxis
                stroke="#4b6cb7"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                label={{ value: 'Fuel (MT/day)', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#112654', border: '1px solid #1e3a6e', borderRadius: '8px', fontSize: '12px' }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(value: number) => [`${value.toFixed(1)} MT/day`, 'Fuel']}
                labelFormatter={(label) => `Speed: ${label} kn`}
              />
              <Legend wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }} />
              <ReferenceLine
                x={OPTIMAL_SPEED}
                stroke="#14b8a6"
                strokeDasharray="4 4"
                label={{ value: `Optimal ${OPTIMAL_SPEED} kn`, position: 'top', fill: '#14b8a6', fontSize: 11 }}
              />
              <ReferenceLine
                x={selectedSpeed}
                stroke="#f59e0b"
                strokeWidth={1.5}
                label={{ value: `Current ${selectedSpeed} kn`, position: 'insideTopRight', fill: '#f59e0b', fontSize: 10 }}
              />
              <Line
                type="monotone"
                dataKey="fuelPerDay"
                stroke="#3b82f6"
                strokeWidth={2.5}
                dot={false}
                name="Fuel Consumption"
                activeDot={{ r: 5, fill: '#3b82f6' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Controls + Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Speed slider + inputs */}
        <div className="card space-y-5">
          <h3 className="font-semibold text-white text-sm">Voyage Parameters</h3>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-gray-300 text-sm font-medium">Current Speed</label>
              <span className="text-teal-400 font-bold text-lg">{selectedSpeed} kn</span>
            </div>
            <input
              type="range"
              min={8}
              max={18}
              step={0.5}
              value={selectedSpeed}
              onChange={(e) => setSelectedSpeed(Number(e.target.value))}
              className="w-full h-2 bg-navy-600 rounded-lg appearance-none cursor-pointer accent-teal-500"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>8 kn (min)</span>
              <span className="text-teal-400">13.5 kn (optimal)</span>
              <span>18 kn (max)</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Fuel Price ($/MT)
            </label>
            <input
              type="number"
              value={fuelPrice}
              onChange={(e) => setFuelPrice(Number(e.target.value))}
              min={300}
              max={1200}
              className="w-full bg-navy-700 border border-navy-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Voyage Distance (nm)
            </label>
            <input
              type="number"
              value={voyageDistance}
              onChange={(e) => setVoyageDistance(Number(e.target.value))}
              min={100}
              max={15000}
              className="w-full bg-navy-700 border border-navy-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600 transition-colors"
            />
          </div>

          <div className="p-3 bg-teal-900/20 border border-teal-800/50 rounded-lg text-xs text-teal-400">
            Recommended speed: <strong>{OPTIMAL_SPEED} kn</strong> — best fuel economy for this vessel class
          </div>
        </div>

        {/* Results */}
        <div className="card">
          <h3 className="font-semibold text-white text-sm mb-4">Voyage Calculations @ {selectedSpeed} kn</h3>
          <div className="grid grid-cols-2 gap-3">
            <StatItem
              icon={<Wind className="w-4 h-4 text-blue-400" />}
              label="Daily Fuel Burn"
              value={`${dailyFuel.toFixed(1)} MT`}
              sub="at selected speed"
            />
            <StatItem
              icon={<DollarSign className="w-4 h-4 text-green-400" />}
              label="Voyage Fuel Cost"
              value={`$${Math.round(voyageCost).toLocaleString()}`}
              sub={`${voyageFuel.toFixed(0)} MT total`}
            />
            <StatItem
              icon={<Leaf className="w-4 h-4 text-emerald-400" />}
              label="Estimated CO2"
              value={`${co2.toFixed(1)} t`}
              sub="VLSFO factor 3.114"
            />
            <StatItem
              icon={<Gauge className="w-4 h-4 text-amber-400" />}
              label="Voyage Duration"
              value={`${voyageDays.toFixed(1)} days`}
              sub={`${Math.round(voyageDays * 24)} hours`}
            />
          </div>

          <div className="mt-4 p-3 rounded-lg border border-navy-600 bg-navy-700/30">
            <p className="text-xs text-gray-400 mb-1">vs Optimal Speed ({OPTIMAL_SPEED} kn)</p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Cost difference</span>
              <span className={`font-bold text-sm ${costDiff > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {costDiff > 0 ? '+' : ''}${Math.round(costDiff).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-sm text-gray-300">Fuel difference</span>
              <span className={`font-bold text-sm ${voyageFuel > optimalVoyageFuel ? 'text-red-400' : 'text-green-400'}`}>
                {voyageFuel > optimalVoyageFuel ? '+' : ''}{(voyageFuel - optimalVoyageFuel).toFixed(1)} MT
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
