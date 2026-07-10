import { useState, useEffect } from 'react'
import { AlertTriangle, Anchor } from 'lucide-react'
import { portsApi } from '@/lib/api'
import { MOCK_PORT_CONGESTION } from '@/lib/mockData'
import type { PortCongestion as PortCongestionType, CongestionLevel } from '@/lib/types'
import { getCongestionColor } from '@/lib/utils'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

const COUNTRY_FLAGS: Record<string, string> = {
  UAE: '🇦🇪',
  Singapore: '🇸🇬',
  Malaysia: '🇲🇾',
  Netherlands: '🇳🇱',
  USA: '🇺🇸',
}

const CONGESTION_COLORS: Record<CongestionLevel, string> = {
  low: '#22c55e',
  medium: '#3b82f6',
  high: '#f59e0b',
  congested: '#ef4444',
}

const CONGESTION_LABELS: Record<CongestionLevel, string> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  congested: 'CONGESTED',
}

const NEXT_BERTH: Record<string, string> = {
  p1: 'Nov 21 06:00',
  p2: 'Nov 18 12:00',
  p3: 'Immediate',
  p4: 'Nov 20 08:00',
  p5: 'Nov 22 14:00',
  p6: 'Immediate',
}

export default function PortCongestion() {
  const [ports, setPorts] = useState<PortCongestionType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    setIsLoading(true)
    portsApi.getCongestion()
      .then(setPorts)
      .catch(() => {
        setPorts(MOCK_PORT_CONGESTION)
      })
      .finally(() => setIsLoading(false))
  }, [])

  if (isLoading) {
    return (
      <div className="card flex items-center justify-center h-64">
        <LoadingSpinner label="Loading port congestion data..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Port Congestion Intelligence</h2>
        <p className="text-gray-400 text-sm mt-0.5">Real-time port congestion and 7-day forecast</p>
      </div>

      {/* High congestion alerts */}
      {ports.filter((p) => p.congestionLevel === 'high' || p.congestionLevel === 'congested').map((p) => (
        <div
          key={p.portId}
          className="flex items-start gap-3 bg-amber-900/20 border border-amber-700 rounded-xl px-4 py-3"
        >
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-300 text-sm font-medium">
              {COUNTRY_FLAGS[p.country] ?? ''} {p.portName} — {CONGESTION_LABELS[p.congestionLevel]} CONGESTION
            </p>
            {p.alerts?.map((alert, i) => (
              <p key={i} className="text-amber-400/80 text-xs mt-1">
                {alert.includes('fuel') || alert.includes('speed')
                  ? `Consider 2-knot speed reduction to save ~18 MT fuel and arrive at optimal berth window`
                  : alert}
              </p>
            ))}
          </div>
        </div>
      ))}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {ports.map((port) => {
          const chartData = port.forecast.map((f, i) => ({
            day: `D+${i + 1}`,
            level:
              f.level === 'low' ? 1 : f.level === 'medium' ? 2 : f.level === 'high' ? 3 : 4,
            color: CONGESTION_COLORS[f.level],
          }))

          return (
            <div key={port.portId} className="card space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-white text-sm">
                    {COUNTRY_FLAGS[port.country] ?? ''} {port.portName}
                  </p>
                  <p className="text-xs text-gray-500">{port.country}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-semibold border ${getCongestionColor(port.congestionLevel)}`}>
                  {CONGESTION_LABELS[port.congestionLevel]}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-navy-700 rounded-lg p-2">
                  <p className="text-xs text-gray-400">Avg Wait</p>
                  <p className="text-white font-bold text-sm">{port.avgWaitingTime}h</p>
                </div>
                <div className="bg-navy-700 rounded-lg p-2">
                  <p className="text-xs text-gray-400 flex items-center justify-center gap-1">
                    <Anchor className="w-3 h-3" /> At Anchor
                  </p>
                  <p className="text-white font-bold text-sm">{port.vesselsAtAnchor}</p>
                </div>
                <div className="bg-navy-700 rounded-lg p-2">
                  <p className="text-xs text-gray-400">Next Berth</p>
                  <p className="text-white font-bold text-xs leading-tight">
                    {NEXT_BERTH[port.portId] ?? 'TBD'}
                  </p>
                </div>
              </div>

              {/* 7-day mini chart — hand-rolled SVG. Recharts' Bar+YAxis scale
                  computed a ~0 height for every bar regardless of value in
                  this small a container, so draw it directly instead. */}
              <div>
                <p className="text-xs text-gray-400 mb-1">7-Day Forecast</p>
                <svg viewBox="0 0 374 48" width="100%" height={48} preserveAspectRatio="none">
                  {chartData.map((entry, i) => {
                    const barWidth = 374 / chartData.length - 6
                    const x = i * (374 / chartData.length) + 3
                    const barHeight = Math.max((entry.level / 4) * 44, 4)
                    const y = 48 - barHeight
                    const labels = ['', 'Low', 'Medium', 'High', 'Congested']
                    return (
                      <rect key={entry.day} x={x} y={y} width={barWidth} height={barHeight} rx={2} ry={2} fill={entry.color}>
                        <title>{`${entry.day}: ${labels[entry.level]}`}</title>
                      </rect>
                    )
                  })}
                </svg>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
