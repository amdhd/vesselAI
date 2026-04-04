import { useState, useMemo } from 'react'
import { Download, Filter } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { formatNumber } from '@/lib/utils'

interface EmissionRecord {
  id: string
  date: string
  route: string
  fuelType: 'HFO' | 'MGO' | 'VLSFO' | 'LNG'
  fuelMT: number
  co2MT: number
  soxMT: number
  noxMT: number
}

const CO2_FACTORS: Record<string, number> = { HFO: 3.114, VLSFO: 3.151, MGO: 3.206, LNG: 2.75 }
const SOX_FACTORS: Record<string, number> = { HFO: 0.027, VLSFO: 0.005, MGO: 0.002, LNG: 0.0001 }
const NOX_FACTORS: Record<string, number> = { HFO: 0.082, VLSFO: 0.080, MGO: 0.075, LNG: 0.012 }

const ROUTES = [
  'Kerteh → Singapore', 'Singapore → Labuan', 'Labuan → Kerteh',
  'Kerteh → Fujairah', 'Fujairah → Singapore', 'Singapore → Rotterdam',
  'Port Klang → Fujairah', 'Fujairah → Kerteh', 'Singapore → Houston',
  'Kerteh → Port Klang', 'Port Klang → Singapore', 'Fujairah → Rotterdam',
]
const FUEL_TYPES: Array<'HFO' | 'MGO' | 'VLSFO' | 'LNG'> = ['HFO', 'VLSFO', 'MGO', 'LNG']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function generateMockData(vesselId: string): EmissionRecord[] {
  const seed = vesselId === 'v2' ? 1.3 : vesselId === 'v3' ? 0.6 : 1.0
  const records: EmissionRecord[] = []
  MONTHS.forEach((_month, i) => {
    const ft = FUEL_TYPES[i % FUEL_TYPES.length]
    const fuel = parseFloat((180 + Math.sin(i * 0.9) * 40 + Math.random() * 30).toFixed(1)) * seed
    records.push({
      id: `em-${vesselId}-${i}`,
      date: `2026-${String(i + 1).padStart(2, '0')}-15`,
      route: ROUTES[i % ROUTES.length],
      fuelType: ft,
      fuelMT: parseFloat(fuel.toFixed(1)),
      co2MT: parseFloat((fuel * CO2_FACTORS[ft]).toFixed(1)),
      soxMT: parseFloat((fuel * SOX_FACTORS[ft]).toFixed(3)),
      noxMT: parseFloat((fuel * NOX_FACTORS[ft]).toFixed(3)),
    })
  })
  return records
}

const fuelTypeBadge: Record<string, string> = {
  HFO: 'bg-orange-900/50 text-orange-300 border border-orange-800',
  VLSFO: 'bg-blue-900/50 text-blue-300 border border-blue-800',
  MGO: 'bg-purple-900/50 text-purple-300 border border-purple-800',
  LNG: 'bg-green-900/50 text-green-300 border border-green-800',
}

export default function EmissionsLog() {
  const { selectedVessel } = useFleet()
  const [monthFilter, setMonthFilter] = useState<string>('All')

  const vesselId = selectedVessel?.id ?? 'v1'
  const allRecords = useMemo(() => generateMockData(vesselId), [vesselId])

  const filtered = useMemo(() => {
    if (monthFilter === 'All') return allRecords
    const idx = MONTHS.indexOf(monthFilter)
    return allRecords.filter((r) => r.date.startsWith(`2026-${String(idx + 1).padStart(2, '0')}`))
  }, [allRecords, monthFilter])

  const totals = useMemo(
    () => ({
      fuelMT: filtered.reduce((s, r) => s + r.fuelMT, 0),
      co2MT: filtered.reduce((s, r) => s + r.co2MT, 0),
      soxMT: filtered.reduce((s, r) => s + r.soxMT, 0),
      noxMT: filtered.reduce((s, r) => s + r.noxMT, 0),
    }),
    [filtered],
  )

  const downloadCSV = () => {
    const header = 'Date,Route,Fuel Type,Fuel (MT),CO2 (MT),SOx (MT),NOx (MT)\n'
    const rows = filtered.map((r) =>
      `${r.date},${r.route},${r.fuelType},${r.fuelMT},${r.co2MT},${r.soxMT},${r.noxMT}`,
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `emissions-log-${vesselId}-2026.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Emissions Log</h2>
          <p className="text-gray-400 text-sm mt-0.5">
            {selectedVessel?.name ?? 'All Vessels'} — 2026 emission records
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="bg-navy-700 border border-navy-600 rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="All">All Months</option>
              {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button onClick={downloadCSV} className="btn-secondary flex items-center gap-2 text-sm">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700 bg-navy-900/50">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Date</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Route</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Fuel Type</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Fuel (MT)</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">CO2 (MT)</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">SOx (MT)</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">NOx (MT)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr
                  key={r.id}
                  className={`border-b border-navy-700/50 hover:bg-navy-700/30 transition-colors ${i % 2 === 0 ? '' : 'bg-navy-900/20'}`}
                >
                  <td className="px-4 py-3 text-gray-300">{r.date}</td>
                  <td className="px-4 py-3 text-gray-300">{r.route}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${fuelTypeBadge[r.fuelType]}`}>
                      {r.fuelType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-white font-medium">{formatNumber(r.fuelMT, 1)}</td>
                  <td className="px-4 py-3 text-right text-amber-400 font-medium">{formatNumber(r.co2MT, 1)}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{r.soxMT.toFixed(3)}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{r.noxMT.toFixed(3)}</td>
                </tr>
              ))}
              {/* Summary row */}
              <tr className="bg-teal-900/20 border-t-2 border-teal-700">
                <td className="px-4 py-3 font-bold text-teal-400" colSpan={3}>
                  TOTALS ({filtered.length} records)
                </td>
                <td className="px-4 py-3 text-right font-bold text-white">{formatNumber(totals.fuelMT, 1)}</td>
                <td className="px-4 py-3 text-right font-bold text-amber-400">{formatNumber(totals.co2MT, 1)}</td>
                <td className="px-4 py-3 text-right font-bold text-white">{totals.soxMT.toFixed(3)}</td>
                <td className="px-4 py-3 text-right font-bold text-white">{totals.noxMT.toFixed(3)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
