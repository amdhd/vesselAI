import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ship, Activity, Route, Anchor } from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  CartesianGrid,
} from 'recharts'
import { analyticsApi } from '@/lib/api'

// The Fleet Analytics page reads ONLY the gold layer (via the analytics API),
// so it stays fast no matter how large the raw AIS feed is (7M rows -> a few KB
// of pre-aggregated JSON). Data flow: NOAA CSV -> bronze -> silver -> gold -> here.

const TEAL = '#0d9488'
const TYPE_COLORS: Record<string, string> = {
  Cargo: '#0d9488',
  Tanker: '#0ea5e9',
  Passenger: '#8b5cf6',
  'Tug / Tow': '#f59e0b',
  Fishing: '#22c55e',
  'Other / Unknown': '#64748b',
}
const tooltipStyle = { background: '#0f1720', border: '1px solid #1e2a35', borderRadius: 6, color: '#eceef0' }

function Kpi({ icon: Icon, label, value }: { icon: typeof Ship; label: string; value: string }) {
  return (
    <div className="bg-navy-800 border border-navy-700 rounded-md px-4 py-3.5">
      <div className="flex items-center gap-2 text-[#767d88] text-[11px] uppercase tracking-wider mb-1.5">
        <Icon size={13} className="text-teal-600" strokeWidth={1.8} /> {label}
      </div>
      <div className="text-[#f0f1f3] text-[22px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}

export default function AnalyticsPage() {
  const summary = useQuery({ queryKey: ['analytics', 'summary'], queryFn: analyticsApi.getSummary })
  const types = useQuery({ queryKey: ['analytics', 'types'], queryFn: analyticsApi.getVesselTypes })
  const top = useQuery({ queryKey: ['analytics', 'top'], queryFn: () => analyticsApi.getTopVessels(12) })
  const idling = useQuery({ queryKey: ['analytics', 'idling'], queryFn: () => analyticsApi.getIdling(25) })

  const failed = summary.isError || types.isError || top.isError || idling.isError
  const dataReady = !!(types.data && top.data)

  // Recharts' ResponsiveContainer can under-measure its width on first paint
  // (before the flex layout settles), leaving bars collapsed. Once the chart
  // data has arrived, nudge a resize on the next frame so it recomputes.
  useEffect(() => {
    if (!dataReady) return
    const fire = () => window.dispatchEvent(new Event('resize'))
    const raf = requestAnimationFrame(fire)
    const timer = window.setTimeout(fire, 150)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [dataReady])

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6">
        <h1 className="text-[23px] font-semibold text-[#f0f1f3] tracking-[-0.01em]">Fleet Analytics</h1>
        <p className="text-[#767d88] text-[13px] mt-[5px]">
          AIS vessel activity from the data platform — bronze → silver → gold (DuckDB + dbt), served from the gold layer
          {summary.data ? ` · ${summary.data.first_day}` : ''}
        </p>
      </div>

      {failed && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-[13px] rounded-md px-4 py-3 mb-4">
          Couldn’t reach the analytics API. From <code className="text-red-200">data-platform/</code> run{' '}
          <code className="text-red-200">uvicorn api.main:app --port 8000</code> (after building the warehouse with dbt).
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi icon={Ship} label="Vessels" value={summary.data ? summary.data.vessels.toLocaleString() : '—'} />
          <Kpi
            icon={Activity}
            label="Position reports"
            value={summary.data ? summary.data.position_reports.toLocaleString() : '—'}
          />
          <Kpi
            icon={Route}
            label="Distance (nm)"
            value={summary.data ? Math.round(summary.data.total_distance_nm).toLocaleString() : '—'}
          />
          <Kpi
            icon={Anchor}
            label="Idle episodes"
            value={summary.data ? summary.data.idle_episodes.toLocaleString() : '—'}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Vessels by type — only mount the chart once data is present, so
              ResponsiveContainer measures a settled layout with real data. */}
          <div className="bg-navy-800 border border-navy-700 rounded-md p-4">
            <h2 className="text-[#f0f1f3] text-[14px] font-semibold mb-3">Vessels by type</h2>
            {!types.data ? (
              <div className="h-[260px] flex items-center justify-center text-[#5c6470] text-[12px]">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={types.data} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2a35" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#767d88', fontSize: 11 }} />
                  <YAxis type="category" dataKey="type" width={92} tick={{ fill: '#a4abb5', fontSize: 11 }} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#ffffff08' }} />
                  <Bar dataKey="vessels" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                    {types.data.map((d) => (
                      <Cell key={d.type} fill={TYPE_COLORS[d.type] ?? TEAL} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top vessels by distance */}
          <div className="bg-navy-800 border border-navy-700 rounded-md p-4">
            <h2 className="text-[#f0f1f3] text-[14px] font-semibold mb-3">Top vessels by distance travelled (nm)</h2>
            {!top.data ? (
              <div className="h-[260px] flex items-center justify-center text-[#5c6470] text-[12px]">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={top.data} layout="vertical" margin={{ left: 36 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2a35" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#767d88', fontSize: 11 }} />
                  <YAxis type="category" dataKey="vessel_name" width={128} tick={{ fill: '#a4abb5', fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#ffffff08' }} />
                  <Bar dataKey="distance_nm" fill={TEAL} radius={[0, 3, 3, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Idling table */}
        <div className="bg-navy-800 border border-navy-700 rounded-md p-4">
          <h2 className="text-[#f0f1f3] text-[14px] font-semibold mb-1">Longest idle episodes</h2>
          <p className="text-[#767d88] text-[12px] mb-3">
            Vessels near-stationary for extended periods — a port-congestion / fuel-burn signal.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[#767d88] text-left border-b border-navy-700">
                  <th className="py-2 pr-4 font-medium">Vessel</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Idle start</th>
                  <th className="py-2 pr-4 font-medium text-right">Idle (min)</th>
                  <th className="py-2 pr-4 font-medium text-right">Lat</th>
                  <th className="py-2 pr-4 font-medium text-right">Lon</th>
                </tr>
              </thead>
              <tbody className="text-[#c9ced6]">
                {(idling.data ?? []).map((e, i) => (
                  <tr key={i} className="border-b border-navy-700/50">
                    <td className="py-1.5 pr-4 text-[#eceef0]">{e.vessel_name}</td>
                    <td className="py-1.5 pr-4">{e.vessel_type_desc}</td>
                    <td className="py-1.5 pr-4 tabular-nums">{e.idle_start.replace('T', ' ').slice(0, 16)}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{e.idle_minutes.toLocaleString()}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{e.avg_lat.toFixed(3)}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{e.avg_lon.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
