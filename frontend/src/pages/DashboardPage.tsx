import { Ship, Gauge, AlertTriangle, TrendingUp, CheckCircle, XCircle, AlertCircle, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useFleet } from '@/context/FleetContext'
import StatCard from '@/components/ui/StatCard'
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
    const ciiStatus: 'green' | 'amber' | 'red' =
      v.ciiRating === 'A' || v.ciiRating === 'B' ? 'green' :
      v.ciiRating === 'C' ? 'amber' : 'red'

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
    color: 'from-teal-900/40 to-teal-800/20 border-teal-800',
  },
  {
    icon: '🔧',
    name: 'Maintenance AI',
    description: 'Equipment health monitoring, predictive maintenance and work orders',
    link: '/maintenance',
    color: 'from-blue-900/40 to-blue-800/20 border-blue-800',
  },
  {
    icon: '📊',
    name: 'Compliance Hub',
    description: 'CII ratings, EU ETS tracking and MRV data reporting',
    link: '/compliance',
    color: 'from-purple-900/40 to-purple-800/20 border-purple-800',
  },
  {
    icon: '⚓',
    name: 'Port Intelligence',
    description: 'Real-time congestion data, demurrage monitoring and agent comms',
    link: '/ports',
    color: 'from-amber-900/40 to-amber-800/20 border-amber-800',
  },
  {
    icon: '📚',
    name: 'Knowledge Base',
    description: 'AI-powered vessel documents, defect reports and handover reports',
    link: '/knowledge',
    color: 'from-green-900/40 to-green-800/20 border-green-800',
  },
  {
    icon: '🔍',
    name: 'SIRE Readiness',
    description: 'Inspection readiness scoring, findings tracking and compliance chat',
    link: '/sire',
    color: 'from-red-900/40 to-red-800/20 border-red-800',
  },
]

function CIIBadge({ rating, status }: { rating: string; status: 'green' | 'amber' | 'red' }) {
  const colors = {
    green: 'text-green-400 bg-green-900/30',
    amber: 'text-yellow-400 bg-yellow-900/30',
    red: 'text-red-400 bg-red-900/30',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold', colors[status])}>
      {rating}
      <span className="w-2 h-2 rounded-full" style={{ background: status === 'green' ? '#22c55e' : status === 'amber' ? '#eab308' : '#ef4444' }} />
    </span>
  )
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical') return <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
  if (severity === 'warning') return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
  if (severity === 'success') return <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
  return <AlertCircle className="w-4 h-4 text-blue-400 shrink-0" />
}

function severityBadgeClass(severity: string) {
  if (severity === 'critical') return 'badge-critical'
  if (severity === 'warning') return 'badge-warning'
  if (severity === 'success') return 'badge-healthy'
  return 'badge-info'
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
          <h1 className="text-2xl font-bold text-white">
            {greeting}, Captain {firstName}
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">{today} — Fleet Overview</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-navy-800 border border-navy-700 rounded-lg text-xs text-gray-400">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          {vessels.length} vessel{vessels.length !== 1 ? 's' : ''} tracked
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Vessels"
          value={vessels.length || 3}
          subtitle="Petronas Marine Fleet"
          icon={Ship}
          iconBg="bg-teal-600/20"
          iconColor="text-teal-400"
        />
        <StatCard
          title="Fleet Fuel Efficiency"
          value={`${efficiencyScore}/100`}
          subtitle={trendLabel}
          icon={Gauge}
          variant="teal"
          iconBg="bg-green-600/20"
          iconColor="text-green-400"
        />
        <StatCard
          title="Active Alerts"
          value={activeAlerts}
          subtitle={activeAlerts > 0 ? 'Requires attention' : 'All clear'}
          icon={AlertTriangle}
          variant={activeAlerts > 0 ? 'amber' : 'default'}
          iconBg={activeAlerts > 0 ? 'bg-amber-600/20' : 'bg-navy-700'}
          iconColor={activeAlerts > 0 ? 'text-amber-400' : 'text-gray-400'}
        />
        <StatCard
          title="Monthly AI Savings"
          value={savingsFormatted}
          subtitle="Fuel + maintenance avoidance"
          icon={TrendingUp}
          variant="teal"
          iconBg="bg-green-600/20"
          iconColor="text-green-400"
        />
      </div>

      {/* Fleet Compliance Matrix + Recent Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Compliance Matrix */}
        <div className="xl:col-span-2 card">
          <h2 className="text-base font-semibold text-white mb-4">Fleet Compliance Matrix</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700">
                  <th className="text-left text-gray-400 font-medium pb-3 pr-4">Vessel</th>
                  <th className="text-left text-gray-400 font-medium pb-3 pr-4">CII</th>
                  <th className="text-left text-gray-400 font-medium pb-3 pr-4">ETS</th>
                  <th className="text-left text-gray-400 font-medium pb-3 pr-4">MRV</th>
                  <th className="text-left text-gray-400 font-medium pb-3">Certificates</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-700/50">
                {complianceMatrix.map((row) => (
                  <tr key={row.id} className="hover:bg-navy-700/20 transition-colors">
                    <td className="py-3 pr-4 font-medium text-white">{row.vessel}</td>
                    <td className="py-3 pr-4">
                      <CIIBadge rating={row.ciiRating} status={row.ciiStatus} />
                    </td>
                    <td className="py-3 pr-4">
                      {row.ets === 'compliant' ? (
                        <span className="flex items-center gap-1 text-green-400 text-xs">
                          <CheckCircle className="w-3.5 h-3.5" /> Compliant
                        </span>
                      ) : row.ets === 'warning' ? (
                        <span className="flex items-center gap-1 text-amber-400 text-xs">
                          <AlertTriangle className="w-3.5 h-3.5" /> At Risk
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400 text-xs">
                          <XCircle className="w-3.5 h-3.5" /> Non-compliant
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-gray-300 text-xs">{row.mrv}</span>
                    </td>
                    <td className="py-3">
                      {row.certStatus === 'valid' ? (
                        <span className="flex items-center gap-1 text-green-400 text-xs">
                          <CheckCircle className="w-3.5 h-3.5" /> {row.certs}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400 text-xs">
                          <XCircle className="w-3.5 h-3.5" /> {row.certs}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 pt-4 border-t border-navy-700">
            <Link to="/compliance" className="text-teal-400 hover:text-teal-300 text-xs flex items-center gap-1 transition-colors">
              View full compliance report <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Recent Alerts</h2>
          <div className="space-y-3">
            {recentAlerts.map((alert) => (
              <div key={alert.id} className="flex gap-3 p-3 bg-navy-700/40 rounded-lg border border-navy-700/50">
                <SeverityIcon severity={alert.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-white text-xs font-medium leading-snug">{alert.title}</p>
                    <span className={cn(severityBadgeClass(alert.severity), 'shrink-0')}>{alert.severity}</span>
                  </div>
                  {alert.vesselName && (
                    <p className="text-gray-500 text-xs mt-0.5">{alert.vesselName}</p>
                  )}
                  <p className="text-gray-500 text-xs mt-1">{timeAgo(alert.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-navy-700">
            <Link to="/maintenance" className="text-teal-400 hover:text-teal-300 text-xs flex items-center gap-1 transition-colors">
              View all alerts <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Quick Navigation */}
      <div>
        <h2 className="text-base font-semibold text-white mb-4">Fleet Modules</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {QUICK_MODULES.map((mod) => (
            <Link
              key={mod.link}
              to={mod.link}
              className={cn(
                'card bg-gradient-to-br border hover:scale-[1.01] transition-transform group',
                mod.color
              )}
            >
              <div className="flex items-start justify-between">
                <span className="text-2xl">{mod.icon}</span>
                <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
              </div>
              <h3 className="text-white font-semibold mt-3">{mod.name}</h3>
              <p className="text-gray-400 text-xs mt-1 leading-relaxed">{mod.description}</p>
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
