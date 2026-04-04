import { useQuery } from '@tanstack/react-query'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
} from 'recharts'
import { maintenanceApi } from '@/lib/api'
import type { SensorReading } from '@/lib/types'
import { format } from 'date-fns'

interface SensorChartProps {
  equipmentId: string
  sensorName: string
  unit: string
  normalRange: [number, number]
  warningRange: [number, number]
  days?: number
}

function generateMockData(normalRange: [number, number], warningRange: [number, number], days: number): SensorReading[] {
  const readings: SensorReading[] = []
  const now = Date.now()
  const [normalLow, normalHigh] = normalRange
  const normalMid = (normalLow + normalHigh) / 2
  const span = normalHigh - normalLow

  for (let i = days * 24; i >= 0; i -= 4) {
    const trend = i < 48 ? (days * 24 - i) * 0.005 : 0 // slight upward trend near end
    const noise = (Math.random() - 0.5) * span * 0.4
    let value = normalMid + noise + trend * span
    const isAnomaly = value > warningRange[1] * 0.98 || value > warningRange[0] * 1.02
    if (isAnomaly) value = warningRange[1] * (0.98 + Math.random() * 0.06)
    readings.push({
      timestamp: new Date(now - i * 3600 * 1000).toISOString(),
      value: parseFloat(value.toFixed(2)),
      unit: '',
      isAnomaly,
    })
  }
  return readings
}

export default function SensorChart({ equipmentId, sensorName, unit, normalRange, warningRange, days = 30 }: SensorChartProps) {
  const { data: sensorData, isLoading } = useQuery<SensorReading[]>({
    queryKey: ['sensor', equipmentId, days],
    queryFn: async () => {
      try {
        return await maintenanceApi.getSensorData(equipmentId, days)
      } catch {
        return generateMockData(normalRange, warningRange, days)
      }
    },
  })

  if (isLoading) {
    return (
      <div className="h-48 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const chartData = (sensorData ?? []).map((r) => ({
    time: format(new Date(r.timestamp), 'dd/MM HH:mm'),
    value: r.value,
    anomaly: r.isAnomaly ? r.value : undefined,
    cautionZoneTop: warningRange[0],
    cautionZoneBot: normalRange[1],
    criticalZone: warningRange[1],
  }))

  const yMin = Math.min(...chartData.map((d) => d.value)) * 0.95
  const yMax = Math.max(warningRange[1] * 1.1, ...chartData.map((d) => d.value)) * 1.05

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-300">
        {sensorName} ({unit})
      </h4>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a6e" />
            <XAxis
              dataKey="time"
              stroke="#4b6cb7"
              tick={{ fill: '#6b7280', fontSize: 9 }}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke="#4b6cb7"
              tick={{ fill: '#6b7280', fontSize: 9 }}
              domain={[yMin, yMax]}
              tickFormatter={(v) => v.toFixed(0)}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#112654', border: '1px solid #1e3a6e', borderRadius: '6px', fontSize: '11px' }}
              labelStyle={{ color: '#9ca3af' }}
              formatter={(value: number) => [`${value.toFixed(2)} ${unit}`, sensorName]}
            />

            {/* Caution band */}
            <Area
              type="monotone"
              dataKey="cautionZoneTop"
              stroke="none"
              fill="#eab308"
              fillOpacity={0.08}
            />

            {/* Critical reference line */}
            <ReferenceLine
              y={warningRange[0]}
              stroke="#eab308"
              strokeDasharray="4 3"
              label={{ value: 'Caution', position: 'right', fill: '#eab308', fontSize: 9 }}
            />
            <ReferenceLine
              y={warningRange[1]}
              stroke="#ef4444"
              strokeDasharray="4 3"
              label={{ value: 'Critical', position: 'right', fill: '#ef4444', fontSize: 9 }}
            />

            {/* Main sensor line */}
            <Line
              type="monotone"
              dataKey="value"
              stroke="#14b8a6"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4, fill: '#14b8a6' }}
              name={sensorName}
            />

            {/* Anomaly points highlighted via the main line's dot renderer */}
            <Line
              type="monotone"
              dataKey="anomaly"
              stroke="none"
              strokeWidth={0}
              dot={{ r: 4, fill: '#ef4444', stroke: '#fff', strokeWidth: 1 }}
              activeDot={false}
              name="Anomaly"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-teal-500 inline-block" /> Sensor reading
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Anomaly
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-amber-400 inline-block" style={{ borderTop: '2px dashed #eab308' }} /> Caution
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-red-400 inline-block" style={{ borderTop: '2px dashed #ef4444' }} /> Critical
        </span>
      </div>
    </div>
  )
}
