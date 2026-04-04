import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { X, Cpu, AlertTriangle, ClipboardList, Zap, ChevronDown, ChevronUp, Plus } from 'lucide-react'
import type { Equipment, WorkOrder, MaintenanceAlert } from '@/lib/types'
import { maintenanceApi } from '@/lib/api'
import { MOCK_ALERTS, MOCK_WORK_ORDERS } from '@/lib/mockData'
import { formatDate, timeAgo, cn } from '@/lib/utils'
import SensorChart from './SensorChart'

interface EquipmentDetailProps {
  equipment: Equipment
  onClose: () => void
}

type TabId = 'sensors' | 'alerts' | 'workorders'

const TABS = [
  { id: 'sensors' as TabId, label: 'Sensor Charts', icon: Cpu },
  { id: 'alerts' as TabId, label: 'Alerts', icon: AlertTriangle },
  { id: 'workorders' as TabId, label: 'Work Orders', icon: ClipboardList },
]

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

function PriorityBadge({ priority }: { priority: WorkOrder['priority'] }) {
  const map: Record<WorkOrder['priority'], string> = {
    critical: 'badge-critical',
    high: 'badge-warning',
    medium: 'badge-info',
    low: 'bg-navy-700 text-gray-400 border border-navy-600 text-xs px-2 py-0.5 rounded-full',
  }
  return <span className={cn(map[priority], 'capitalize')}>{priority}</span>
}

export default function EquipmentDetail({ equipment, onClose }: EquipmentDetailProps) {
  const [activeTab, setActiveTab] = useState<TabId>('sensors')
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null)
  const [analysisOpen, setAnalysisOpen] = useState(false)

  const { data: alerts } = useQuery<MaintenanceAlert[]>({
    queryKey: ['alerts', equipment.vesselId],
    queryFn: async () => {
      try {
        return await maintenanceApi.getAlerts(equipment.vesselId)
      } catch {
        return MOCK_ALERTS.filter((a) => a.equipmentId === equipment.id)
      }
    },
  })

  const { data: workOrders } = useQuery<WorkOrder[]>({
    queryKey: ['work-orders', equipment.vesselId],
    queryFn: async () => {
      try {
        return await maintenanceApi.getWorkOrders(equipment.vesselId)
      } catch {
        return MOCK_WORK_ORDERS.filter((w) => w.equipmentId === equipment.id)
      }
    },
  })

  const { mutate: analyzeWithAI, isPending: isAnalyzing } = useMutation({
    mutationFn: () =>
      maintenanceApi.analyzeAnomaly({ equipmentId: equipment.id, vesselId: equipment.vesselId }),
    onSuccess: (data) => {
      setAiAnalysis(data.analysis)
      setAnalysisOpen(true)
    },
  })

  const equipmentAlerts = alerts?.filter((a) => a.equipmentId === equipment.id) ?? []
  const equipmentWorkOrders = workOrders?.filter((w) => w.equipmentId === equipment.id) ?? []

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="fixed top-0 right-0 h-full w-full max-w-[600px] bg-navy-900 border-l border-navy-700 z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-navy-700 shrink-0">
          <div>
            <div className="flex items-center gap-3">
              <Cpu className="w-5 h-5 text-teal-400" />
              <h2 className="text-lg font-bold text-white">{equipment.name}</h2>
              <StatusBadge status={equipment.status} />
            </div>
            <p className="text-gray-400 text-sm mt-1">
              {equipment.manufacturer} {equipment.model} — {equipment.serialNumber}
            </p>
            <p className="text-gray-500 text-xs mt-0.5">
              Health score: <span className="text-white font-semibold">{equipment.healthScore}/100</span>
              <span className="mx-2">·</span>
              {equipment.runningHours.toLocaleString()} running hours
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-navy-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-3 border-b border-navy-700 shrink-0">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === tab.id
                    ? 'bg-teal-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-navy-700'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* AI Analysis result */}
          {aiAnalysis && (
            <div className="mb-4 card border-teal-700/50 bg-teal-900/10">
              <button
                className="flex items-center justify-between w-full text-left"
                onClick={() => setAnalysisOpen(!analysisOpen)}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-teal-400">
                  <Zap className="w-4 h-4" /> AI Analysis
                </span>
                {analysisOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {analysisOpen && (
                <p className="mt-3 text-gray-300 text-sm leading-relaxed">{aiAnalysis}</p>
              )}
            </div>
          )}

          {/* Sensors tab */}
          {activeTab === 'sensors' && (
            <div className="space-y-6">
              {equipment.sensors.map((sensor) => (
                <div key={sensor.id} className="card">
                  <SensorChart
                    equipmentId={equipment.id}
                    sensorName={sensor.name}
                    unit={sensor.unit}
                    normalRange={sensor.normalRange}
                    warningRange={sensor.warningRange}
                    days={30}
                  />
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-navy-700/50 rounded p-2">
                      <p className="text-gray-500">Current</p>
                      <p className="text-white font-semibold">{sensor.currentValue} {sensor.unit}</p>
                    </div>
                    <div className="bg-navy-700/50 rounded p-2">
                      <p className="text-gray-500">Normal range</p>
                      <p className="text-white font-semibold">{sensor.normalRange[0]}–{sensor.normalRange[1]}</p>
                    </div>
                    <div className="bg-navy-700/50 rounded p-2">
                      <p className="text-gray-500">Warning range</p>
                      <p className="text-amber-400 font-semibold">{sensor.warningRange[0]}–{sensor.warningRange[1]}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Alerts tab */}
          {activeTab === 'alerts' && (
            <div className="space-y-3">
              {equipmentAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <AlertTriangle className="w-10 h-10 text-gray-600 mb-3" />
                  <p className="text-gray-400">No active alerts for this equipment</p>
                </div>
              ) : (
                equipmentAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={cn(
                      'card border',
                      alert.severity === 'critical' ? 'border-red-800 bg-red-900/10' : 'border-amber-800 bg-amber-900/10'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className={cn('w-4 h-4 shrink-0 mt-0.5', alert.severity === 'critical' ? 'text-red-400' : 'text-amber-400')} />
                        <div>
                          <p className="text-white text-sm font-medium">{alert.message}</p>
                          <p className="text-gray-500 text-xs mt-1">{timeAgo(alert.detectedAt)}</p>
                          {alert.daysToFailure !== undefined && (
                            <p className="text-red-400 text-xs mt-1 font-medium">
                              Estimated {alert.daysToFailure} day{alert.daysToFailure !== 1 ? 's' : ''} to failure
                            </p>
                          )}
                        </div>
                      </div>
                      <span className={cn(alert.severity === 'critical' ? 'badge-critical' : 'badge-warning')}>
                        {alert.severity}
                      </span>
                    </div>
                    {alert.aiAnalysis && (
                      <div className="mt-3 p-3 bg-navy-700/50 rounded-lg border border-navy-600 text-xs text-gray-300 leading-relaxed">
                        <span className="text-teal-400 font-medium">AI: </span>{alert.aiAnalysis}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Work orders tab */}
          {activeTab === 'workorders' && (
            <div className="space-y-3">
              {equipmentWorkOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <ClipboardList className="w-10 h-10 text-gray-600 mb-3" />
                  <p className="text-gray-400">No work orders for this equipment</p>
                </div>
              ) : (
                equipmentWorkOrders.map((wo) => (
                  <div key={wo.id} className="card">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-white text-sm font-medium">{wo.title}</h4>
                        <p className="text-gray-400 text-xs mt-0.5">{wo.description}</p>
                      </div>
                      <PriorityBadge priority={wo.priority} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500">Assigned to</span>
                        <p className="text-gray-300">{wo.assignedTo ?? 'Unassigned'}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Planned date</span>
                        <p className="text-gray-300">{formatDate(wo.plannedDate)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-navy-700 flex gap-3 shrink-0">
          <button
            onClick={() => analyzeWithAI()}
            disabled={isAnalyzing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-teal-600/20 hover:bg-teal-600/30 border border-teal-700 text-teal-400 transition-colors disabled:opacity-50"
          >
            {isAnalyzing ? (
              <div className="w-4 h-4 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            Analyze with AI
          </button>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium btn-secondary">
            <Plus className="w-4 h-4" />
            Create Work Order
          </button>
        </div>
      </div>
    </>
  )
}
