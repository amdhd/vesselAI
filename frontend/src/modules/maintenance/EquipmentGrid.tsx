import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { AlertTriangle, Cpu, Zap } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { maintenanceApi } from '@/lib/api'
import { MOCK_EQUIPMENT, MOCK_ALERTS } from '@/lib/mockData'
import type { Equipment } from '@/lib/types'
import { formatDate, getHealthBg, cn } from '@/lib/utils'
import EquipmentDetail from './EquipmentDetail'

function HealthCircle({ score }: { score: number }) {
  const radius = 30
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (score / 100) * circumference
  const color = getHealthBg(score)

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#1e3a6e" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform="rotate(-90 40 40)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <span
        className="absolute text-lg font-bold"
        style={{ color }}
      >
        {score}
      </span>
    </div>
  )
}

function StatusBadge({ status }: { status: Equipment['status'] }) {
  const map: Record<Equipment['status'], string> = {
    healthy: 'badge-healthy',
    warning: 'badge-warning',
    critical: 'badge-critical',
    offline: 'bg-gray-800 text-gray-400 border border-gray-700 text-xs px-2 py-0.5 rounded-full',
    maintenance: 'badge-info',
  }
  const labels: Record<Equipment['status'], string> = {
    healthy: 'Healthy',
    warning: 'Watch',
    critical: 'Critical',
    offline: 'Offline',
    maintenance: 'In Maintenance',
  }
  return <span className={map[status]}>{labels[status]}</span>
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
      className="card cursor-pointer hover:border-teal-700/50 hover:bg-navy-750 transition-all group"
    >
      {/* Alert banner */}
      {hasAlert && (
        <div className="flex items-center gap-2 mb-3 p-2 bg-red-900/30 border border-red-800/50 rounded-lg text-red-400 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Anomaly Detected — AI flagged bearing issue
        </div>
      )}

      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white truncate group-hover:text-teal-300 transition-colors">
            {equipment.name}
          </h3>
          <p className="text-gray-500 text-xs mt-0.5">{equipment.type} — {equipment.manufacturer}</p>
        </div>
        <div className="ml-3">
          <HealthCircle score={equipment.healthScore} />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <StatusBadge status={equipment.status} />
        <span className="text-gray-500 text-xs">{equipment.runningHours.toLocaleString()} hrs</span>
      </div>

      <div className="mt-3 pt-3 border-t border-navy-700 grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-gray-500">Last maintenance</span>
          <p className="text-gray-300 mt-0.5">{formatDate(equipment.lastMaintenance)}</p>
        </div>
        <div>
          <span className="text-gray-500">Next maintenance</span>
          <p className="text-gray-300 mt-0.5">{formatDate(equipment.nextMaintenance)}</p>
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

  const { mutate: analyzeAll, isPending: isAnalyzing } = useMutation({
    mutationFn: async () => {
      const flagged = equipment?.filter((e) => e.status === 'warning' || e.status === 'critical') ?? []
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
  const sortedEquipment = [...(equipment ?? [])].sort((a, b) => a.healthScore - b.healthScore)

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
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              flaggedCount > 0
                ? 'bg-amber-600/20 hover:bg-amber-600/30 border border-amber-700 text-amber-400'
                : 'bg-navy-700 border border-navy-600 text-gray-500 cursor-not-allowed'
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
          <div className="card border-amber-700/50 bg-amber-900/10">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-amber-400 font-semibold text-sm">AI Analysis Result</span>
            </div>
            <p className="text-gray-300 text-sm leading-relaxed">{analyzeResult}</p>
          </div>
        )}

        {/* Equipment grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
