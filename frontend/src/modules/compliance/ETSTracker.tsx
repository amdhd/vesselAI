import { useState, useEffect } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { AlertTriangle, Euro, TrendingUp } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { complianceApi } from '@/lib/api'
import { MOCK_ETS_DATA } from '@/lib/mockData'
import type { ETSData } from '@/lib/types'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { formatNumber } from '@/lib/utils'

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div className="w-full bg-navy-700 h-[5px] mt-2">
      <div
        className={`h-[5px] transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default function ETSTracker() {
  const { selectedVessel } = useFleet()
  const [etsData, setEtsData] = useState<ETSData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedVessel) return
    setIsLoading(true)
    setError(null)

    complianceApi.getETS(selectedVessel.id).then(setEtsData).catch(() => {
      const mock = MOCK_ETS_DATA[selectedVessel.id]
      if (mock) setEtsData(mock)
      else setError('No ETS data available for this vessel.')
    }).finally(() => setIsLoading(false))
  }, [selectedVessel])

  if (!selectedVessel) {
    return (
      <div className="card flex items-center justify-center h-64 text-gray-400">
        Select a vessel to view EU ETS data.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="card flex items-center justify-center h-64">
        <LoadingSpinner label="Loading EU ETS data..." />
      </div>
    )
  }

  if (error || !etsData) {
    return (
      <div className="card flex items-center justify-center h-64 text-status-red">
        {error ?? 'Failed to load ETS data.'}
      </div>
    )
  }

  const allowancePct = (etsData.allowancesPurchased / etsData.allowancesRequired) * 100
  const co2Pct = (etsData.totalCO2 / etsData.annualEstimate) * 100
  const isOverThreshold = allowancePct >= 80

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">EU ETS Cost Tracker</h2>
        <p className="text-gray-400 text-sm mt-1">
          European Emissions Trading System — {selectedVessel.name}
        </p>
      </div>

      {/* Alert banner */}
      {isOverThreshold && (
        <div className="flex items-center gap-3 bg-navy-800 border border-status-amber rounded-[2px] px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-status-amber flex-shrink-0" />
          <p className="text-status-amber text-sm">
            <strong>Alert:</strong> Allowances used exceeds 80% of annual requirement. Consider purchasing additional
            ETS allowances to avoid penalties.
          </p>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-teal-400" />
            <span className="text-xs text-gray-400">Total CO2 YTD</span>
          </div>
          <p className="font-mono text-3xl font-semibold text-white">{formatNumber(etsData.totalCO2)}</p>
          <p className="text-xs text-gray-500 mt-0.5">metric tonnes</p>
          <ProgressBar value={etsData.totalCO2} max={etsData.annualEstimate} color={co2Pct > 80 ? 'bg-status-amber' : 'bg-teal-600'} />
          <p className="text-xs text-gray-500 mt-1">{co2Pct.toFixed(0)}% of annual estimate</p>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <Euro className="w-4 h-4 text-teal-400" />
            <span className="text-xs text-gray-400">Running EUR Cost</span>
          </div>
          <p className="font-mono text-3xl font-semibold text-white">€{formatNumber(etsData.eurCost)}</p>
          <p className="text-xs text-gray-500 mt-0.5">year-to-date</p>
        </div>

        <div className="card">
          <p className="text-xs text-gray-400 mb-2">Allowances Purchased vs Required</p>
          <div className="flex items-end gap-2">
            <span className="font-mono text-2xl font-semibold text-status-green">{formatNumber(etsData.allowancesPurchased)}</span>
            <span className="text-gray-500 pb-1">/</span>
            <span className="font-mono text-2xl font-semibold text-white">{formatNumber(etsData.allowancesRequired)}</span>
          </div>
          <ProgressBar
            value={etsData.allowancesPurchased}
            max={etsData.allowancesRequired}
            color={allowancePct >= 80 ? 'bg-status-amber' : 'bg-status-green'}
          />
          <p className="text-xs text-gray-500 mt-1">{allowancePct.toFixed(0)}% covered</p>
        </div>

        <div className="card">
          <p className="text-xs text-gray-400 mb-2">Projected Year-End Bill</p>
          <p className="font-mono text-3xl font-semibold text-status-amber">€{formatNumber(etsData.projectedYearEndCost)}</p>
          <p className="text-xs text-gray-500 mt-0.5">estimated total cost</p>
        </div>
      </div>

      {/* Monthly CO2 bar chart */}
      <div className="card">
        <h3 className="text-sm font-semibold text-white mb-4">Monthly CO2 Emissions (MT)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={etsData.monthlyData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.09)" />
            <XAxis dataKey="month" tick={{ fill: '#5c6470', fontSize: 11 }} />
            <YAxis tick={{ fill: '#5c6470', fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#12161a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '2px', color: '#fff' }}
              formatter={(value: number) => [`${formatNumber(value)} MT`, 'CO2']}
            />
            <Bar dataKey="co2" name="CO2 (MT)" fill="#3a8c85" radius={[0, 0, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
