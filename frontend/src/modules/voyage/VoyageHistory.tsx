import { useQuery } from '@tanstack/react-query'
import { Clock, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { voyageApi } from '@/lib/api'
import { MOCK_VOYAGE_HISTORY } from '@/lib/mockData'
import type { VoyageHistoryRecord } from '@/lib/types'
import { formatDate, formatFuel, cn } from '@/lib/utils'
import Badge from '@/components/ui/Badge'

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-4 bg-navy-700 rounded" />
        </td>
      ))}
    </tr>
  )
}

function SavingsCell({ savings }: { savings: number }) {
  const isPositive = savings > 0
  return (
    <span className={cn('flex items-center gap-1 font-mono font-medium text-sm', isPositive ? 'text-status-green' : 'text-status-red')}>
      {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {isPositive ? '+' : ''}${Math.abs(savings * 650).toLocaleString()}
    </span>
  )
}

function CIIImpactCell({ impact }: { impact: number }) {
  const isPositive = impact < 0
  return (
    <span className={cn('font-mono text-sm font-medium', isPositive ? 'text-status-green' : 'text-status-red')}>
      {impact > 0 ? '+' : ''}{impact.toFixed(2)}
    </span>
  )
}

export default function VoyageHistory() {
  const { selectedVessel } = useFleet()

  const { data: history, isLoading, isError } = useQuery<VoyageHistoryRecord[]>({
    queryKey: ['voyage-history', selectedVessel?.id],
    queryFn: async () => {
      if (!selectedVessel) return MOCK_VOYAGE_HISTORY
      try {
        return await voyageApi.getHistory(selectedVessel.id)
      } catch {
        return MOCK_VOYAGE_HISTORY.filter((v) => v.vesselId === selectedVessel.id)
      }
    },
    enabled: true,
  })

  const totalSavings = history?.reduce((sum, v) => sum + (v.savings > 0 ? v.savings * 650 : 0), 0) ?? 0

  if (isError) {
    return (
      <div className="card text-center py-10">
        <p className="text-status-red">Failed to load voyage history</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-teal-400" />
            Voyage History — {selectedVessel?.name ?? 'All Vessels'}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                {['Departure', 'Route', 'Distance', 'Planned Fuel', 'Actual Fuel', 'Savings ($)', 'CII Impact', 'Status'].map((h) => (
                  <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#5c6470] pb-3 px-4 first:pl-0 last:pr-0 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-700/50">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
              ) : !history || history.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <Clock className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400">No voyage history found</p>
                    <p className="text-gray-600 text-xs mt-1">Completed voyages will appear here</p>
                  </td>
                </tr>
              ) : (
                history.map((voyage) => {
                  const distance = Math.round(800 + Math.random() * 400)
                  return (
                    <tr key={voyage.id} className="hover:bg-navy-700/20 transition-colors">
                      <td className="py-3 px-4 pl-0 text-gray-300 font-mono whitespace-nowrap">{formatDate(voyage.departureDate)}</td>
                      <td className="py-3 px-4 text-white whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          {voyage.route.split(' → ')[0]}
                          <ArrowRight className="w-3 h-3 text-gray-500 shrink-0" />
                          {voyage.route.split(' → ')[1]}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-300 font-mono">{distance} nm</td>
                      <td className="py-3 px-4 text-gray-300 font-mono">{formatFuel(voyage.plannedFuel)}</td>
                      <td className="py-3 px-4 text-gray-300 font-mono">{formatFuel(voyage.actualFuel)}</td>
                      <td className="py-3 px-4">
                        <SavingsCell savings={voyage.savings} />
                      </td>
                      <td className="py-3 px-4">
                        <CIIImpactCell impact={voyage.ciiImpact} />
                      </td>
                      <td className="py-3 px-4 pr-0">
                        <Badge variant="healthy">completed</Badge>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Summary row */}
        {history && history.length > 0 && (
          <div className="mt-5 pt-4 border-t border-navy-700 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <TrendingUp className="w-4 h-4 text-status-green" />
              <span className="text-gray-400">Total savings this month:</span>
              <span className="text-status-green font-mono font-semibold">${totalSavings.toLocaleString()}</span>
            </div>
            <span className="text-gray-500 text-xs">{history.length} voyages</span>
          </div>
        )}
      </div>
    </div>
  )
}
