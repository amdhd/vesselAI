import { AlertTriangle, CheckCircle, XCircle, AlertCircle, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
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

const QUICK_MODULES = [
  {
    icon: '🧭',
    name: 'Voyage Optimizer',
    description: 'AI route planning, speed optimization and voyage history tracking',
    link: '/voyage',
  },
  {
    icon: '🔧',
    name: 'Maintenance AI',
    description: 'Equipment health monitoring, predictive maintenance and work orders',
    link: '/maintenance',
  },
  {
    icon: '📊',
    name: 'Compliance Hub',
    description: 'CII ratings, EU ETS tracking and MRV data reporting',
    link: '/compliance',
  },
  {
    icon: '⚓',
    name: 'Port Intelligence',
    description: 'Real-time congestion data, demurrage monitoring and agent comms',
    link: '/ports',
  },
  {
    icon: '📚',
    name: 'Knowledge Base',
    description: 'AI-powered vessel documents, defect reports and handover reports',
    link: '/knowledge',
  },
  {
    icon: '🔍',
    name: 'SIRE Readiness',
    description: 'Inspection readiness scoring, findings tracking and compliance chat',
    link: '/sire',
  },
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

      {/* Quick Navigation */}
      <div>
        <h2 className="text-[14px] font-semibold text-[#e2e4e7] mb-4">Fleet Modules</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {QUICK_MODULES.map((mod) => (
            <Link
              key={mod.link}
              to={mod.link}
              className="bg-navy-800 border border-navy-700 rounded-[2px] p-5 hover:border-teal-600/50 hover:bg-white/[0.015] transition-colors group"
            >
              <div className="flex items-start justify-between">
                <span className="text-2xl">{mod.icon}</span>
                <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
              </div>
              <h3 className="text-[#e2e4e7] font-semibold mt-3 text-[13.5px]">{mod.name}</h3>
              <p className="text-[#767d88] text-xs mt-1 leading-relaxed">{mod.description}</p>
              <p className="text-teal-400 text-xs mt-3 font-medium group-hover:text-teal-300 transition-colors">
                Go to Module →
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
