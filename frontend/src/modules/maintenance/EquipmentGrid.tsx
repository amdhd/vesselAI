import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { AlertTriangle, Cpu, Zap } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { maintenanceApi } from '@/lib/api'
import { MOCK_EQUIPMENT, MOCK_ALERTS } from '@/lib/mockData'
import type { Equipment } from '@/lib/types'
import { formatDate, getHealthBg, cn } from '@/lib/utils'
import Badge from '@/components/ui/Badge'
import EquipmentDetail from './EquipmentDetail'

function HealthCircle({ score }: { score: number }) {
  const radius = 24
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (score / 100) * circumference
  const color = getHealthBg(score)

  return (
    <div className="relative inline-flex items-center justify-center shrink-0">
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform="rotate(-90 28 28)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <span className="absolute font-mono text-[15px] font-semibold text-[#e2e4e7]">{score}</span>
    </div>
  )
}

const statusVariant: Record<Equipment['status'], 'healthy' | 'warning' | 'critical' | 'info' | 'default'> = {
  healthy: 'healthy',
  warning: 'warning',
  critical: 'critical',
  offline: 'default',
  maintenance: 'info',
}

const statusLabel: Record<Equipment['status'], string> = {
  healthy: 'Healthy',
  warning: 'Watch',
  critical: 'Critical',
  offline: 'Offline',
  maintenance: 'In Maintenance',
}

function StatusBadge({ status }: { status: Equipment['status'] }) {
  return <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>
}

interface EquipmentCardProps {
  equipment: Equipment
  hasAlert: boolean
  onClick: (equipment: Equipment) => void
}

function EquipmentCard({ equipment, hasAlert, onClick }: EquipmentCardProps) {
  return (
    <div
      onClick={() => onClick(equipment)}
      className="bg-navy-800 p-5 cursor-pointer hover:bg-white/[0.015] transition-colors group"
    >
      {/* Alert banner */}
      {hasAlert && (
        <div className="flex items-center gap-2 mb-3 p-2 border border-status-red text-status-red rounded-[2px] text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Anomaly Detected — AI flagged bearing issue
        </div>
      )}

      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[#e2e4e7] text-[14px] truncate group-hover:text-teal-300 transition-colors">
            {equipment.name}
          </h3>
          <p className="text-[#767d88] text-[11.5px] mt-[3px]">{equipment.manufacturer}</p>
        </div>
        <div className="ml-3">
          <HealthCircle score={equipment.healthScore} />
        </div>
      </div>

      <div className="mt-4 pt-3.5 border-t border-white/[0.06] flex items-center justify-between">
        <StatusBadge status={equipment.status} />
        <span className="text-[#767d88] text-[11.5px] font-mono">{equipment.runningHours.toLocaleString()} hrs</span>
      </div>

      <div className="mt-3.5 flex justify-between text-xs">
        <div>
          <span className="text-[10px] text-[#5c6470] uppercase tracking-wide">Last maint.</span>
          <p className="text-[#c7cbd1] text-xs mt-[3px]">{formatDate(equipment.lastMaintenance)}</p>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-[#5c6470] uppercase tracking-wide">Next maint.</span>
          <p className="text-[#c7cbd1] text-xs mt-[3px]">{formatDate(equipment.nextMaintenance)}</p>
        </div>
      </div>
    </div>
  )
}

export default function EquipmentGrid() {
  const { selectedVessel } = useFleet()
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null)
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null)

  const { data: equipment, isLoading } = useQuery<Equipment[]>({
    queryKey: ['equipment', selectedVessel?.id],
    queryFn: async () => {
      if (!selectedVessel) return MOCK_EQUIPMENT
      try {
        return await maintenanceApi.getEquipment(selectedVessel.id)
      } catch {
        return MOCK_EQUIPMENT.filter((e) => e.vesselId === selectedVessel.id)
      }
    },
    enabled: true,
  })

  // A persisted react-query cache can rehydrate a stale, non-array value here
  // (e.g. from before the API unwrapped `{ equipment }`), so coerce defensively:
  // `?? []` only guards nullish, and spreading/filtering a wrong-typed object throws.
  const equipmentList: Equipment[] = Array.isArray(equipment) ? equipment : []

  const { mutate: analyzeAll, isPending: isAnalyzing } = useMutation({
    mutationFn: async () => {
      const flagged = equipmentList.filter((e) => e.status === 'warning' || e.status === 'critical')
      if (flagged.length === 0) return { analysis: 'No flagged equipment to analyze.' }
      return maintenanceApi.analyzeAnomaly({
        equipmentId: flagged[0].id,
        vesselId: flagged[0].vesselId,
      })
    },
    onSuccess: (data) => {
      setAnalyzeResult(data.analysis)
    },
  })

  const alertEquipmentIds = new Set(MOCK_ALERTS.map((a) => a.equipmentId))

  // Sort worst health first
  const sortedEquipment = [...equipmentList].sort((a, b) => a.healthScore - b.healthScore)

  if (!selectedVessel) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <Cpu className="w-12 h-12 text-gray-600 mb-4" />
        <h3 className="text-white font-semibold">No vessel selected</h3>
        <p className="text-gray-400 text-sm mt-2">Select a vessel from the top bar to view equipment</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-4 bg-navy-700 rounded mb-3 w-3/4" />
            <div className="h-20 bg-navy-700 rounded mb-3" />
            <div className="h-4 bg-navy-700 rounded w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  const flaggedCount = sortedEquipment.filter((e) => e.status === 'warning' || e.status === 'critical').length

  return (
    <>
      <div className="space-y-4">
        {/* Analyze button */}
        <div className="flex items-center justify-between">
          <p className="text-gray-400 text-sm">
            {sortedEquipment.length} equipment units — {flaggedCount} flagged for review
          </p>
          <button
            onClick={() => analyzeAll()}
            disabled={isAnalyzing || flaggedCount === 0}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-[2px] text-[12.5px] font-semibold transition-colors border',
              flaggedCount > 0
                ? 'border-status-amber text-status-amber hover:bg-status-amber/10'
                : 'border-navy-600 text-gray-500 cursor-not-allowed'
            )}
          >
            {isAnalyzing ? (
              <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            Analyze All Flagged Equipment
          </button>
        </div>

        {/* Analysis result */}
        {analyzeResult && (
          <div className="border border-status-amber/50 bg-navy-800 rounded-[2px] p-5">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-status-amber" />
              <span className="text-status-amber font-semibold text-sm">AI Analysis Result</span>
            </div>
            <p className="text-gray-300 text-sm leading-relaxed">{analyzeResult}</p>
          </div>
        )}

        {/* Equipment grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-navy-700 border border-navy-700">
          {sortedEquipment.map((eq) => (
            <EquipmentCard
              key={eq.id}
              equipment={eq}
              hasAlert={alertEquipmentIds.has(eq.id)}
              onClick={setSelectedEquipment}
            />
          ))}
        </div>
      </div>

      {/* Equipment detail panel */}
      {selectedEquipment && (
        <EquipmentDetail
          equipment={selectedEquipment}
          onClose={() => setSelectedEquipment(null)}
        />
      )}
    </>
  )
}
