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
import { tok } from '@/lib/theme'

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
  const { data: sensorData, isLoading, isError } = useQuery<SensorReading[]>({
    queryKey: ['sensor', equipmentId, sensorName, days],
    queryFn: async () => {
      try {
        return await maintenanceApi.getSensorData(equipmentId, days, sensorName)
      } catch (err) {
        // Fixtures are a dev convenience only. Never present invented readings
        // as a real sensor trend — an operator reading a fabricated anomaly
        // curve is worse than an explicit failure.
        if (import.meta.env.DEV) return generateMockData(normalRange, warningRange, days)
        throw err
      }
    },
  })

  if (isLoading) {
    return (
      <div className="h-48 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Also guards the empty case: the domain maths below would otherwise compute
  // Math.min() of an empty array (Infinity).
  if (isError || !sensorData || sensorData.length === 0) {
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-ink-2">
          {sensorName} ({unit})
        </h4>
        <div className="h-48 flex items-center justify-center text-sm text-faint">
          {isError ? 'Sensor data unavailable' : 'No sensor data for this period'}
        </div>
      </div>
    )
  }

  const chartData = sensorData.map((r) => ({
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
      <h4 className="text-sm font-medium text-ink-2">
        {sensorName} ({unit})
      </h4>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid stroke={tok('light', 0.05)} />
            <XAxis
              dataKey="time"
              stroke={tok('rule')}
              tick={{ fill: tok('muted'), fontSize: 9 }}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke={tok('rule')}
              tick={{ fill: tok('muted'), fontSize: 9 }}
              domain={[yMin, yMax]}
              tickFormatter={(v) => v.toFixed(0)}
            />
            <Tooltip
              contentStyle={{ backgroundColor: tok('paper-2'), border: `1px solid ${tok('light', 0.1)}`, borderRadius: '10px', fontSize: '11px' }}
              labelStyle={{ color: tok('ink-2') }}
              formatter={(value: number) => [`${value.toFixed(2)} ${unit}`, sensorName]}
            />

            {/* Caution band */}
            <Area
              type="monotone"
              dataKey="cautionZoneTop"
              stroke="none"
              fill={tok('apricot')}
              fillOpacity={0.08}
            />

            {/* Critical reference line */}
            <ReferenceLine
              y={warningRange[0]}
              stroke={tok('apricot')}
              strokeDasharray="4 3"
              label={{ value: 'Caution', position: 'right', fill: tok('apricot'), fontSize: 9 }}
            />
            <ReferenceLine
              y={warningRange[1]}
              stroke={tok('critical')}
              strokeDasharray="4 3"
              label={{ value: 'Critical', position: 'right', fill: tok('critical'), fontSize: 9 }}
            />

            {/* Main sensor line */}
            <Line
              type="monotone"
              dataKey="value"
              stroke={tok('accent')}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4, fill: tok('accent') }}
              name={sensorName}
            />

            {/* Anomaly points highlighted via the main line's dot renderer */}
            <Line
              type="monotone"
              dataKey="anomaly"
              stroke="none"
              strokeWidth={0}
              dot={{ r: 4, fill: tok('critical'), stroke: tok('ink'), strokeWidth: 1 }}
              activeDot={false}
              name="Anomaly"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 text-xs text-faint">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-accent inline-block" /> Sensor reading
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-status-red inline-block" /> Anomaly
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 inline-block" style={{ borderTop: `2px dashed ${tok('apricot')}` }} /> Caution
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 inline-block" style={{ borderTop: `2px dashed ${tok('critical')}` }} /> Critical
        </span>
      </div>
    </div>
  )
}
