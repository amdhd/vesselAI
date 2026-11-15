import { AlertTriangle, CheckCircle, XCircle, AlertCircle, Ship } from 'lucide-react'
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
import { tok } from '@/lib/theme'

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
  { label: 'Fleet CO₂ intensity',  value: '4.82', unit: 'gCO₂/dwt-nm', sub: '+0.62 vs required',        subColor: 'text-status-red'   },
  { label: 'Crew certification',   value: '46',   unit: '/48 valid',   sub: '2 expiring within 30 days', subColor: 'text-status-amber' },
  { label: 'Bunker spend (MTD)',   value: '$284K', unit: '',           sub: '-6.2% vs budget',           subColor: 'text-status-green' },
  { label: 'Off-hire days (YTD)',  value: '3.5',  unit: '',            sub: 'Across 3 vessels',          subColor: 'text-faint'     },
]

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical') return <AlertCircle className="w-4 h-4 text-status-red shrink-0" />
  if (severity === 'warning') return <AlertTriangle className="w-4 h-4 text-status-amber shrink-0" />
  if (severity === 'success') return <CheckCircle className="w-4 h-4 text-status-green shrink-0" />
  return <AlertCircle className="w-4 h-4 text-accent shrink-0" />
}

function severityVariant(severity: string): 'healthy' | 'warning' | 'critical' | 'info' {
  if (severity === 'critical') return 'critical'
  if (severity === 'warning') return 'warning'
  if (severity === 'success') return 'healthy'
  return 'info'
}

/** A panel heading with an optional quiet link on the right. */
function PanelHead({ title, to, linkLabel, aside }: { title: string; to?: string; linkLabel?: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-4">
      <h2 className="text-[16px] text-ink">{title}</h2>
      {aside}
      {to && linkLabel && (
        <Link
          to={to}
          className="text-[13px] font-medium text-accent hover:text-accent-hi underline-offset-4 hover:underline transition-colors"
        >
          {linkLabel}
        </Link>
      )}
    </div>
  )
}

/** One ruled tally of four figures: a single surface split by hairlines, never a grid of tiles. */
function Tally({
  items,
}: {
  items: { label: string; value: React.ReactNode; sub?: string; subColor?: string }[]
}) {
  return (
    <dl className="panel grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 xl:divide-x divide-light/[0.06]">
      {items.map((item) => (
        <div key={item.label} className="px-6 py-5">
          <dt className="label">{item.label}</dt>
          <dd className="mt-2 font-display text-[34px] font-medium tracking-[-0.022em] text-ink leading-none tabular-nums">
            {item.value}
          </dd>
          {item.sub && <dd className={cn('text-[13px] mt-2', item.subColor ?? 'text-muted')}>{item.sub}</dd>}
        </div>
      ))}
    </dl>
  )
}

function EtsCell({ status }: { status: 'compliant' | 'warning' | 'non_compliant' }) {
  if (status === 'compliant')
    return <span className="inline-flex items-center gap-1.5 text-status-green text-[13px]"><CheckCircle className="w-3.5 h-3.5" /> Compliant</span>
  if (status === 'warning')
    return <span className="inline-flex items-center gap-1.5 text-status-amber text-[13px]"><AlertTriangle className="w-3.5 h-3.5" /> At risk</span>
  return <span className="inline-flex items-center gap-1.5 text-status-red text-[13px]"><XCircle className="w-3.5 h-3.5" /> Non-compliant</span>
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { vessels } = useFleet()
  const greeting = getGreeting()
  const firstName = user?.name ?? 'Captain'
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
      <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <h1 className="text-[30px] leading-[1.1] text-ink">
            {greeting}, {firstName}
          </h1>
          <p className="text-muted text-[14px] mt-2">{today}, fleet overview</p>
        </div>
        <p className="inline-flex items-center gap-2 min-h-[34px] px-3.5 rounded-pill bg-light/[0.04] border border-light/[0.08] text-[13px] text-ink-2">
          <Ship className="w-3.5 h-3.5 text-accent" strokeWidth={1.8} />
          {vessels.length} vessel{vessels.length !== 1 ? 's' : ''} tracked
        </p>
      </div>

      {/* Fleet tally */}
      <Tally
        items={[
          { label: 'Total vessels', value: vessels.length || 3, sub: 'Petronas Marine Fleet' },
          {
            label: 'Fleet fuel efficiency',
            value: (
              <>
                {efficiencyScore}
                <span className="text-[0.55em] text-muted">/100</span>
              </>
            ),
            sub: trendLabel,
          },
          {
            label: 'Active alerts',
            value: activeAlerts,
            sub: activeAlerts > 0 ? 'Requires attention' : 'All clear',
            subColor: activeAlerts > 0 ? 'text-status-amber' : 'text-muted',
          },
          { label: 'Monthly AI savings', value: savingsFormatted, sub: 'Fuel + maintenance avoidance' },
        ]}
      />

      {/* Fleet Compliance Matrix + Recent Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Compliance ledger */}
        <section className="xl:col-span-2 panel">
          <PanelHead title="Fleet compliance" to="/compliance" linkLabel="Full compliance report" />
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-y border-light/[0.06]">
                  <th scope="col" className="text-left label py-2.5 pl-6 pr-4">Vessel</th>
                  <th scope="col" className="text-left label py-2.5 pr-4">CII</th>
                  <th scope="col" className="text-left label py-2.5 pr-4">ETS</th>
                  <th scope="col" className="text-left label py-2.5 pr-4">MRV</th>
                  <th scope="col" className="text-left label py-2.5 pr-6">Certificates</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light/[0.06]">
                {complianceMatrix.map((row) => (
                  <tr key={row.id} className="hover:bg-light/[0.02] transition-colors">
                    <td className="py-4 pl-6 pr-4">
                      <span className="flex items-center gap-3 font-medium text-ink">
                        <span aria-hidden="true" className="w-8 h-8 rounded-full bg-light/[0.05] ring-1 ring-light/[0.08] flex items-center justify-center text-[12px] text-ink-2">
                          {(row.vessel.split(' ')[1] ?? row.vessel).charAt(0)}
                        </span>
                        {row.vessel}
                      </span>
                    </td>
                    <td className="py-4 pr-4">
                      <Badge variant={row.ciiStatus}>{row.ciiRating}</Badge>
                    </td>
                    <td className="py-4 pr-4"><EtsCell status={row.ets} /></td>
                    <td className="py-4 pr-4 text-[13px] text-ink-2">{row.mrv}</td>
                    <td className="py-4 pr-6">
                      {row.certStatus === 'valid' ? (
                        <span className="inline-flex items-center gap-1.5 text-status-green text-[13px]">
                          <CheckCircle className="w-3.5 h-3.5" /> {row.certs}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-status-red text-[13px]">
                          <XCircle className="w-3.5 h-3.5" /> {row.certs}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="h-2" />
        </section>

        {/* Recent Alerts */}
        <section className="panel flex flex-col">
          <PanelHead title="Recent alerts" to="/maintenance" linkLabel="All alerts" />
          <ul className="divide-y divide-light/[0.06] border-t border-light/[0.06] flex-1">
            {recentAlerts.map((alert) => (
              <li key={alert.id} className="flex gap-3 px-6 py-4">
                <SeverityIcon severity={alert.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-ink text-[13.5px] font-medium leading-snug">{alert.title}</p>
                    <Badge variant={severityVariant(alert.severity)} className="shrink-0">{alert.severity}</Badge>
                  </div>
                  <p className="text-muted text-[13px] mt-1">
                    {alert.vesselName ? `${alert.vesselName}, ` : ''}{timeAgo(alert.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Fuel Consumption Trend + Upcoming Port Calls */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 panel">
          <PanelHead
            title="Fleet fuel consumption, last 7 days"
            aside={
              <p className="text-[13px] text-muted ml-auto">
                Fleet avg <span className="font-medium text-ink tabular-nums">{FLEET_AVG_FUEL}</span> t/day
              </p>
            }
          />
          <div className="px-4 pb-5">
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={FUEL_TREND} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
                  <CartesianGrid stroke={tok('light', 0.05)} vertical={false} />
                  <XAxis
                    dataKey="day"
                    stroke={tok('rule')}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: tok('muted'), fontSize: 12 }}
                  />
                  <YAxis
                    stroke={tok('rule')}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 24]}
                    ticks={[0, 12, 24]}
                    tick={{ fill: tok('muted'), fontSize: 12 }}
                    tickFormatter={(v) => `${v}t`}
                    width={36}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: tok('paper-2'), border: `1px solid ${tok('light', 0.08)}`, borderRadius: '10px', fontSize: '12px', boxShadow: 'var(--shadow-pop)' }}
                    labelStyle={{ color: tok('ink-2') }}
                    itemStyle={{ color: tok('ink') }}
                    cursor={{ stroke: tok('light', 0.12) }}
                    formatter={(value: number, name: string) => [`${value.toFixed(1)} t`, name === 'actual' ? 'Actual consumption' : 'Baseline plan']}
                  />
                  <Line
                    type="monotone"
                    dataKey="baseline"
                    stroke={tok('faint')}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    activeDot={{ r: 3, fill: tok('faint') }}
                    name="baseline"
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    stroke={tok('accent')}
                    strokeWidth={2.25}
                    dot={{ r: 3, fill: tok('paper-2'), stroke: tok('accent'), strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: tok('accent'), stroke: tok('paper-2'), strokeWidth: 2 }}
                    name="actual"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-6 text-[13px] text-ink-2 px-2 pt-2">
              <span className="flex items-center gap-2">
                <span className="w-4 h-0.5 rounded-full bg-accent inline-block" /> Actual consumption
              </span>
              <span className="flex items-center gap-2">
                <span className="w-4 h-0.5 inline-block" style={{ borderTop: `2px dashed ${tok('faint')}` }} /> Baseline plan
              </span>
            </div>
          </div>
        </section>

        {/* Upcoming Port Calls */}
        <section className="panel flex flex-col">
          <PanelHead title="Upcoming port calls" to="/ports" linkLabel="Port schedule" />
          <ul className="divide-y divide-light/[0.06] border-t border-light/[0.06] flex-1">
            {PORT_CALLS.map((call) => (
              <li key={call.vessel} className="px-6 py-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-ink text-[14px] font-medium">{call.vessel}</p>
                  {call.status === 'on_time' ? (
                    <Badge variant="healthy">On time</Badge>
                  ) : (
                    <Badge variant="warning">Delayed</Badge>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <p className="text-muted text-[13px]">{call.port}</p>
                  <p className="text-ink-2 text-[13px] tabular-nums">{call.eta}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Fleet operations ledger: figures live in rows */}
      <section className="panel">
        <PanelHead title="Fleet operations" />
        <ul className="divide-y divide-light/[0.06] border-t border-light/[0.06]">
          {OPS_KPIS.map((kpi) => (
            <li key={kpi.label} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1 px-6 py-4">
              <p className="text-[14px] text-ink-2">{kpi.label}</p>
              <p className="text-right sm:text-left font-display text-[22px] font-medium text-ink tabular-nums leading-none">
                {kpi.value}
                {kpi.unit && <span className="text-[13px] font-sans text-muted ml-1.5">{kpi.unit}</span>}
              </p>
              <p className={cn('col-span-2 sm:col-span-1 sm:text-right text-[13px]', kpi.subColor)}>{kpi.sub}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
