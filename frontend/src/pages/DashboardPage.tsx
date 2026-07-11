import { AlertTriangle, CheckCircle, XCircle, AlertCircle, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { useAuth } from '@/context/AuthContext'
import { useFleet } from '@/context/FleetContext'
import Badge from '@/components/ui/Badge'
import { MOCK_NOTIFICATIONS, MOCK_VESSELS, MOCK_ETS_DATA, MOCK_ALERTS } from '@/lib/mockData'
import { getGreeting, formatDate, timeAgo, cn } from '@/lib/utils'

// ── Dashboard KPI calculations ────────────────────────────────────────────────

const VLSFO_PRICE_PER_TONNE = 620   // USD/t (market rate)
const CO2_FACTOR_VLSFO       = 3.2  // tCO2 per tonne VLSFO (IMO MEPC.308)
const BASELINE_EFFICIENCY    = 65   // industry avg fuel efficiency score

/**
 * Fleet Fuel Efficiency Score
 * Simple mean of each vessel's fuelEfficiencyScore (0–100).
 * "Previous month" is back-derived from the CII trajectory (Sep→Oct change).
 */
function calcFleetFuelEfficiency(vessels: typeof MOCK_VESSELS) {
  if (!vessels.length) return { score: 0, trend: 0 }

  const current = vessels.reduce((s, v) => s + v.fuelEfficiencyScore, 0) / vessels.length

  // Derive prev-month score from CII trajectory ratio for each vessel
  const prevScores = vessels.map(v => {
    const traj = MOCK_ETS_DATA[v.id]?.monthlyData
    if (!traj || traj.length < 2) return v.fuelEfficiencyScore
    const prevCo2 = traj[traj.length - 2].co2
    const currCo2 = traj[traj.length - 1].co2
    if (currCo2 === 0) return v.fuelEfficiencyScore
    // If CO2 went up, efficiency went down by the same ratio
    return v.fuelEfficiencyScore * (prevCo2 / currCo2)
  })
  const prev = prevScores.reduce((s, x) => s + x, 0) / prevScores.length

  return {
    score: Math.round(current),
    trend: Math.round((current - prev) * 10) / 10,
  }
}

/**
 * Monthly AI Savings (USD)
 * = Fuel savings (vessels above baseline efficiency × their monthly fuel spend)
 * + Maintenance cost avoidance (alerts × estimated repair cost × days-to-failure weight)
 */
function calcMonthlyAiSavings(vessels: typeof MOCK_VESSELS) {
  // Fuel savings per vessel using latest-month ETS CO2 data
  const fuelSavings = vessels.reduce((sum, v) => {
    const ets = MOCK_ETS_DATA[v.id]
    if (!ets) return sum
    const latestCo2 = ets.monthlyData[ets.monthlyData.length - 1]?.co2 ?? 0
    const monthlyFuelCost = (latestCo2 / CO2_FACTOR_VLSFO) * VLSFO_PRICE_PER_TONNE
    const bonus = Math.max(0, v.fuelEfficiencyScore - BASELINE_EFFICIENCY) / 100
    return sum + monthlyFuelCost * bonus
  }, 0)

  // Maintenance cost avoidance: early detection before failure
  const maintenanceSavings = MOCK_ALERTS.reduce((sum, alert) => {
    const avoidedRepairCost = alert.severity === 'critical' ? 85_000 : 25_000
    const daysCaught = Math.min(alert.daysToFailure ?? 7, 7)
    return sum + avoidedRepairCost * (daysCaught / 30)
  }, 0)

  return Math.round(fuelSavings + maintenanceSavings)
}

/**
 * Compliance matrix derived from actual vessel + ETS data.
 * ETS status: compliant if allowancesPurchased / allowancesRequired >= 0.70
 */
const MRV_STATUS: Record<string, string>  = { v1: 'Filed', v2: 'Filed', v3: 'Filed' }
const CERT_STATUS: Record<string, { label: string; ok: 'valid' | 'expired' }> = {
  v1: { label: 'Valid',      ok: 'valid'   },
  v2: { label: '2 Expired',  ok: 'expired' },
  v3: { label: 'Valid',      ok: 'valid'   },
}

function buildComplianceMatrix() {
  return MOCK_VESSELS.map(v => {
    const ets = MOCK_ETS_DATA[v.id]
    const etsCoverage = ets ? ets.allowancesPurchased / ets.allowancesRequired : 1
    const etsStatus = etsCoverage >= 0.85 ? 'compliant' : etsCoverage >= 0.60 ? 'warning' : 'non_compliant'
    const ciiStatus: 'healthy' | 'warning' | 'critical' =
      v.ciiRating === 'A' || v.ciiRating === 'B' ? 'healthy' :
      v.ciiRating === 'C' ? 'warning' : 'critical'

    return {
      id: v.id,
      vessel: v.name,
      ciiRating: v.ciiRating ?? 'C',
      ciiStatus,
      ets: etsStatus as 'compliant' | 'warning' | 'non_compliant',
      mrv: MRV_STATUS[v.id] ?? 'Pending',
      certs: CERT_STATUS[v.id]?.label ?? 'Valid',
      certStatus: CERT_STATUS[v.id]?.ok ?? 'valid',
    }
  })
}

// ── Fleet fuel consumption — 7-day trend (t/day) ──────────────────────────────
const FUEL_TREND = [
  { day: 'Wed', actual: 11.4, baseline: 6.8 },
  { day: 'Thu', actual: 12.1, baseline: 7.1 },
  { day: 'Fri', actual: 10.4, baseline: 7.4 },
  { day: 'Sat', actual: 12.6, baseline: 6.9 },
  { day: 'Sun', actual: 13.5, baseline: 6.5 },
  { day: 'Mon', actual: 12.2, baseline: 6.6 },
  { day: 'Tue', actual: 14.4, baseline: 5.4 },
]
const FLEET_AVG_FUEL = 18.4 // t/day

// ── Upcoming port calls ───────────────────────────────────────────────────────
const PORT_CALLS = [
  { vessel: 'MT Kerteh Venture', port: 'Port of Singapore', status: 'on_time', eta: 'ETA 13 Jul, 06:00' },
  { vessel: 'MV Merdeka Spirit', port: 'Port Klang',        status: 'delayed', eta: 'ETA 14 Jul, 18:30' },
  { vessel: 'OSV Tenaga Satu',   port: 'Bintulu Terminal',  status: 'on_time', eta: 'ETA 16 Jul, 09:15' },
] as const

// ── Fleet operations KPIs ─────────────────────────────────────────────────────
const OPS_KPIS = [
  { label: 'Fleet CO₂ Intensity',  value: '4.82', unit: 'gCO₂/dwt-nm', sub: '+0.62 vs required',        subColor: 'text-status-red'   },
  { label: 'Crew Certification',   value: '46',   unit: '/48 valid',   sub: '2 expiring within 30 days', subColor: 'text-status-amber' },
  { label: 'Bunker Spend (MTD)',   value: '$284K', unit: '',           sub: '-6.2% vs budget',           subColor: 'text-status-green' },
  { label: 'Off-Hire Days (YTD)',  value: '3.5',  unit: '',            sub: 'Across 3 vessels',          subColor: 'text-gray-500'     },
]

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical') return <AlertCircle className="w-4 h-4 text-status-red shrink-0" />
  if (severity === 'warning') return <AlertTriangle className="w-4 h-4 text-status-amber shrink-0" />
  if (severity === 'success') return <CheckCircle className="w-4 h-4 text-status-green shrink-0" />
  return <AlertCircle className="w-4 h-4 text-teal-400 shrink-0" />
}

function severityVariant(severity: string): 'healthy' | 'warning' | 'critical' | 'info' {
  if (severity === 'critical') return 'critical'
  if (severity === 'warning') return 'warning'
  if (severity === 'success') return 'healthy'
  return 'info'
}

function KPIStrip({
  items,
}: {
  items: { label: string; value: React.ReactNode; sub?: string; subColor?: string }[]
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-px bg-navy-700 border border-navy-700">
      {items.map((item) => (
        <div key={item.label} className="bg-navy-800 p-5">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#5c6470] mb-3.5">
            {item.label}
          </p>
          <p className="font-mono text-[26px] font-semibold text-[#f0f1f3] leading-none">{item.value}</p>
          {item.sub && <p className={cn('text-xs mt-1.5', item.subColor ?? 'text-gray-500')}>{item.sub}</p>}
        </div>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { vessels } = useFleet()
  const greeting = getGreeting()
  const firstName = user?.name?.split(' ')[0] ?? 'Captain'
  const today = formatDate(new Date())
  const activeAlerts = MOCK_NOTIFICATIONS.filter((n) => !n.read && (n.severity === 'critical' || n.severity === 'warning')).length
  const recentAlerts = MOCK_NOTIFICATIONS.slice(0, 3)

  // Computed KPIs from actual data
  const vesselData = vessels.length ? vessels : MOCK_VESSELS
  const { score: efficiencyScore, trend: efficiencyTrend } = calcFleetFuelEfficiency(vesselData)
  const monthlySavings = calcMonthlyAiSavings(vesselData)
  const complianceMatrix = buildComplianceMatrix()

  const trendLabel = efficiencyTrend >= 0
    ? `+${efficiencyTrend.toFixed(1)} from last month`
    : `${efficiencyTrend.toFixed(1)} from last month`

  const savingsFormatted = monthlySavings >= 1000
    ? `$${(monthlySavings / 1000).toFixed(1)}K`
    : `$${monthlySavings}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[23px] font-semibold text-[#f0f1f3] tracking-[-0.01em]">
            {greeting}, Captain {firstName}
          </h1>
          <p className="text-[#767d88] text-[13px] mt-[5px]">{today} — Fleet Overview</p>
        </div>
        <div className="flex items-center gap-[7px] px-[13px] py-[7px] bg-[#12161a] border border-white/[0.09] text-xs text-[#a8adb5]">
          <div className="w-1.5 h-1.5 bg-status-green" />
          {vessels.length} vessel{vessels.length !== 1 ? 's' : ''} tracked
        </div>
      </div>

      {/* KPI Cards */}
      <KPIStrip
        items={[
          { label: 'Total Vessels', value: vessels.length || 3, sub: 'Petronas Marine Fleet' },
          {
            label: 'Fleet Fuel Efficiency',
            value: (
              <>
                {efficiencyScore}
                <span className="text-base text-[#5c6470]">/100</span>
              </>
            ),
            sub: trendLabel,
          },
          {
            label: 'Active Alerts',
            value: activeAlerts,
            sub: activeAlerts > 0 ? 'Requires attention' : 'All clear',
            subColor: activeAlerts > 0 ? 'text-status-amber' : 'text-gray-500',
          },
          { label: 'Monthly AI Savings', value: savingsFormatted, sub: 'Fuel + maintenance avoidance' },
        ]}
      />

      {/* Fleet Compliance Matrix + Recent Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Compliance Matrix */}
        <div className="xl:col-span-2 border border-navy-700 bg-navy-800">
          <h2 className="text-[14px] font-semibold text-[#e2e4e7] px-5 py-4 border-b border-navy-700">
            Fleet Compliance Matrix
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700">
                  <th className="text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#5c6470] py-[11px] pl-5 pr-4">Vessel</th>
                  <th className="text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#5c6470] py-[11px] pr-4">CII</th>
                  <th className="text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#5c6470] py-[11px] pr-4">ETS</th>
                  <th className="text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#5c6470] py-[11px] pr-4">MRV</th>
                  <th className="text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#5c6470] py-[11px] pr-5">Certificates</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-700/60">
                {complianceMatrix.map((row) => (
                  <tr key={row.id}>
                    <td className="py-[15px] pl-5 pr-4 font-medium text-[#e2e4e7]">{row.vessel}</td>
                    <td className="py-[15px] pr-4">
                      <Badge variant={row.ciiStatus} className="font-mono">{row.ciiRating}</Badge>
                    </td>
                    <td className="py-[15px] pr-4">
                      {row.ets === 'compliant' ? (
                        <span className="flex items-center gap-1 text-status-green text-xs">
                          <CheckCircle className="w-3.5 h-3.5" /> Compliant
                        </span>
                      ) : row.ets === 'warning' ? (
                        <span className="flex items-center gap-1 text-status-amber text-xs">
                          <AlertTriangle className="w-3.5 h-3.5" /> At Risk
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-status-red text-xs">
                          <XCircle className="w-3.5 h-3.5" /> Non-compliant
                        </span>
                      )}
                    </td>
                    <td className="py-[15px] pr-4">
                      <span className="text-[#a8adb5] text-xs">{row.mrv}</span>
                    </td>
                    <td className="py-[15px] pr-5">
                      {row.certStatus === 'valid' ? (
                        <span className="flex items-center gap-1 text-status-green text-xs">
                          <CheckCircle className="w-3.5 h-3.5" /> {row.certs}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-status-red text-xs">
                          <XCircle className="w-3.5 h-3.5" /> {row.certs}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3.5">
            <Link to="/compliance" className="text-teal-400 hover:text-teal-300 text-xs flex items-center gap-1 transition-colors w-fit">
              View full compliance report <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="border border-navy-700 bg-navy-800">
          <h2 className="text-[14px] font-semibold text-[#e2e4e7] px-5 py-4 border-b border-navy-700">Recent Alerts</h2>
          <div className="divide-y divide-navy-700/60">
            {recentAlerts.map((alert) => (
              <div key={alert.id} className="flex gap-2.5 px-5 py-[15px]">
                <SeverityIcon severity={alert.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[#e2e4e7] text-xs font-semibold leading-snug">{alert.title}</p>
                    <Badge variant={severityVariant(alert.severity)} className="shrink-0">{alert.severity}</Badge>
                  </div>
                  {alert.vesselName && (
                    <p className="text-[#767d88] text-xs mt-0.5">{alert.vesselName}</p>
                  )}
                  <p className="text-[#767d88] text-xs mt-1">{timeAgo(alert.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3.5">
            <Link to="/maintenance" className="text-teal-400 hover:text-teal-300 text-xs flex items-center gap-1 transition-colors w-fit">
              View all alerts <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Fuel Consumption Trend + Upcoming Port Calls */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Fuel Consumption Trend */}
        <div className="xl:col-span-2 border border-navy-700 bg-navy-800">
          <div className="flex items-center justify-between px-5 py-4 border-b border-navy-700">
            <h2 className="text-[14px] font-semibold text-[#e2e4e7]">Fleet Fuel Consumption — 7 Day Trend</h2>
            <p className="text-xs text-[#767d88]">
              Fleet avg <span className="font-mono font-semibold text-teal-400">{FLEET_AVG_FUEL}</span> t/day
            </p>
          </div>
          <div className="px-3 pt-5 pb-3">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={FUEL_TREND} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    stroke="#454b55"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#5c6470', fontSize: 11 }}
                  />
                  <YAxis
                    stroke="#454b55"
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 24]}
                    ticks={[0, 12, 24]}
                    tick={{ fill: '#5c6470', fontSize: 11 }}
                    tickFormatter={(v) => `${v}t`}
                    width={34}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#12161a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '2px', fontSize: '11px' }}
                    labelStyle={{ color: '#a8adb5' }}
                    formatter={(value: number, name: string) => [`${value.toFixed(1)} t`, name === 'actual' ? 'Actual consumption' : 'Baseline plan']}
                  />
                  <Line
                    type="monotone"
                    dataKey="baseline"
                    stroke="#6b7280"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    activeDot={{ r: 3, fill: '#6b7280' }}
                    name="baseline"
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    stroke="#3a8c85"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#3a8c85' }}
                    activeDot={{ r: 4, fill: '#3a8c85' }}
                    name="actual"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-5 text-xs text-[#a8adb5] px-2 pt-1">
              <span className="flex items-center gap-2">
                <span className="w-4 h-0.5 bg-teal-600 inline-block" /> Actual consumption
              </span>
              <span className="flex items-center gap-2">
                <span className="w-4 h-0.5 inline-block" style={{ borderTop: '2px dashed #6b7280' }} /> Baseline plan
              </span>
            </div>
          </div>
        </div>

        {/* Upcoming Port Calls */}
        <div className="border border-navy-700 bg-navy-800 flex flex-col">
          <h2 className="text-[14px] font-semibold text-[#e2e4e7] px-5 py-4 border-b border-navy-700">Upcoming Port Calls</h2>
          <div className="divide-y divide-navy-700/60 flex-1">
            {PORT_CALLS.map((call) => (
              <div key={call.vessel} className="px-5 py-[15px]">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[#e2e4e7] text-[13px] font-semibold">{call.vessel}</p>
                  {call.status === 'on_time' ? (
                    <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-status-green border border-status-green/50 px-1.5 py-0.5">
                      On Time
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-status-amber border border-status-amber/50 px-1.5 py-0.5">
                      Delayed
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <p className="text-[#767d88] text-xs">{call.port}</p>
                  <p className="text-[#a8adb5] text-xs font-mono">{call.eta}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3.5 border-t border-navy-700">
            <Link to="/ports" className="text-teal-400 hover:text-teal-300 text-xs flex items-center gap-1 transition-colors w-fit">
              View port schedule <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Fleet Operations KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-px bg-navy-700 border border-navy-700">
        {OPS_KPIS.map((kpi) => (
          <div key={kpi.label} className="bg-navy-800 p-5">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#5c6470] mb-3.5">
              {kpi.label}
            </p>
            <p className="font-mono text-[26px] font-semibold text-[#f0f1f3] leading-none">
              {kpi.value}
              {kpi.unit && <span className="text-[13px] text-[#5c6470] ml-1.5">{kpi.unit}</span>}
            </p>
            <p className={cn('text-xs mt-2', kpi.subColor)}>{kpi.sub}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
