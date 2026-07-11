import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Plus, X, Calendar, User, Wrench, AlertCircle } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { maintenanceApi } from '@/lib/api'
import { MOCK_WORK_ORDERS } from '@/lib/mockData'
import type { WorkOrder, WorkOrderStatus, WorkOrderPriority } from '@/lib/types'
import { formatDate, cn } from '@/lib/utils'
import Badge from '@/components/ui/Badge'

const COLUMNS: { id: WorkOrderStatus; label: string; color: string }[] = [
  { id: 'open', label: 'Open', color: 'text-status-red border-status-red' },
  { id: 'in_progress', label: 'In Progress', color: 'text-status-amber border-status-amber' },
  { id: 'completed', label: 'Completed', color: 'text-teal-400 border-teal-600' },
  { id: 'verified', label: 'Verified', color: 'text-status-green border-status-green' },
]

const priorityVariant: Record<WorkOrderPriority, 'critical' | 'warning' | 'info' | 'default'> = {
  critical: 'critical',
  high: 'warning',
  medium: 'info',
  low: 'default',
}

function PriorityBadge({ priority }: { priority: WorkOrderPriority }) {
  return <Badge variant={priorityVariant[priority]} className="capitalize">{priority}</Badge>
}

interface WorkOrderCardProps {
  workOrder: WorkOrder
  onClick: (wo: WorkOrder) => void
}

function WorkOrderCard({ workOrder, onClick }: WorkOrderCardProps) {
  return (
    <div
      onClick={() => onClick(workOrder)}
      className="bg-navy-700/60 border border-navy-600 rounded-[2px] p-3 cursor-pointer hover:border-teal-700/50 hover:bg-navy-700 transition-all space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-white text-xs font-medium leading-snug">{workOrder.title}</h4>
        <PriorityBadge priority={workOrder.priority} />
      </div>
      <p className="text-gray-500 text-xs">{workOrder.equipmentName}</p>
      <div className="space-y-1 text-xs text-gray-500">
        {workOrder.assignedTo && (
          <div className="flex items-center gap-1.5">
            <User className="w-3 h-3" />
            <span>{workOrder.assignedTo}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3 h-3" />
          <span>{formatDate(workOrder.plannedDate)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Wrench className="w-3 h-3" />
          <span>{workOrder.estimatedHours}h estimated</span>
        </div>
      </div>
    </div>
  )
}

interface NewWorkOrderModalProps {
  vesselId: string
  onClose: () => void
  onSubmit: (data: Partial<WorkOrder>) => void
  isSubmitting: boolean
}

function NewWorkOrderModal({ vesselId, onClose, onSubmit, isSubmitting }: NewWorkOrderModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [equipmentName, setEquipmentName] = useState('')
  const [priority, setPriority] = useState<WorkOrderPriority>('medium')
  const [assignedTo, setAssignedTo] = useState('')
  const [plannedDate, setPlannedDate] = useState(() => new Date().toISOString().split('T')[0])
  const [estimatedHours, setEstimatedHours] = useState(4)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      title,
      description,
      equipmentName,
      priority,
      assignedTo,
      plannedDate,
      estimatedHours,
      vesselId,
      status: 'open',
      type: 'corrective',
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-navy-800 border border-navy-700 rounded-[2px] w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-navy-700">
          <h3 className="text-white font-semibold">New Work Order</h3>
          <button onClick={onClose} className="p-1.5 rounded-[2px] text-gray-400 hover:text-white hover:bg-navy-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Work order title..."
              className="w-full bg-navy-700 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600 transition-colors"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Equipment</label>
            <input
              value={equipmentName}
              onChange={(e) => setEquipmentName(e.target.value)}
              placeholder="Equipment name..."
              className="w-full bg-navy-700 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600 transition-colors"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the work to be done..."
              rows={3}
              className="w-full bg-navy-700 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600 transition-colors resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as WorkOrderPriority)}
                className="w-full bg-navy-700 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600 transition-colors"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Planned Date</label>
              <input
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
                className="w-full bg-navy-700 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600 transition-colors"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Assigned To</label>
              <input
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="Engineer name..."
                className="w-full bg-navy-700 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Estimated Hours</label>
              <input
                type="number"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(Number(e.target.value))}
                min={1}
                max={200}
                className="w-full bg-navy-700 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600 transition-colors"
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary py-2 text-sm">Cancel</button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 btn-primary py-2 text-sm flex items-center justify-center gap-2"
            >
              {isSubmitting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Create Work Order
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function WorkOrderSystem() {
  const { selectedVessel } = useFleet()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null)

  const { data: workOrders, isLoading } = useQuery<WorkOrder[]>({
    queryKey: ['work-orders-all', selectedVessel?.id],
    queryFn: async () => {
      if (!selectedVessel) return MOCK_WORK_ORDERS
      try {
        return await maintenanceApi.getWorkOrders(selectedVessel.id)
      } catch {
        return MOCK_WORK_ORDERS.filter((w) => w.vesselId === selectedVessel.id)
      }
    },
  })

  const { mutate: createWorkOrder, isPending: isCreating } = useMutation({
    mutationFn: (data: Partial<WorkOrder>) => maintenanceApi.createWorkOrder(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['work-orders-all'] })
      setShowModal(false)
    },
    onError: () => {
      setShowModal(false)
    },
  })

  const getColumnOrders = (status: WorkOrderStatus) =>
    (workOrders ?? []).filter((wo) => wo.status === status)

  if (!selectedVessel) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <ClipboardList className="w-12 h-12 text-gray-600 mb-4" />
        <h3 className="text-white font-semibold">No vessel selected</h3>
        <p className="text-gray-400 text-sm mt-2">Select a vessel to view work orders</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => (
          <div key={col.id} className="card animate-pulse">
            <div className="h-5 bg-navy-700 rounded mb-4 w-1/2" />
            {[1, 2].map((i) => (
              <div key={i} className="h-24 bg-navy-700 rounded mb-3" />
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-gray-400 text-sm">{workOrders?.length ?? 0} total work orders</p>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 btn-primary text-sm"
          >
            <Plus className="w-4 h-4" />
            New Work Order
          </button>
        </div>

        {/* Kanban columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map((col) => {
            const orders = getColumnOrders(col.id)
            return (
              <div key={col.id} className="card flex flex-col gap-3">
                <div className={cn('flex items-center justify-between pb-3 border-b', col.color.split(' ')[1])}>
                  <h3 className={cn('font-semibold text-sm', col.color.split(' ')[0])}>
                    {col.label}
                  </h3>
                  <span className="text-gray-500 text-xs font-mono bg-navy-700 px-2 py-0.5 rounded-[2px]">
                    {orders.length}
                  </span>
                </div>
                {orders.length === 0 ? (
                  <div className="text-center py-6 text-gray-600 text-xs">No orders</div>
                ) : (
                  orders.map((wo) => (
                    <WorkOrderCard key={wo.id} workOrder={wo} onClick={setSelectedWO} />
                  ))
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Work order detail modal */}
      {selectedWO && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-navy-800 border border-navy-700 rounded-[2px] w-full max-w-lg">
            <div className="flex items-start justify-between p-5 border-b border-navy-700">
              <div>
                <h3 className="text-white font-semibold">{selectedWO.title}</h3>
                <p className="text-gray-400 text-sm mt-0.5">{selectedWO.equipmentName}</p>
              </div>
              <button onClick={() => setSelectedWO(null)} className="p-1.5 rounded-[2px] text-gray-400 hover:text-white hover:bg-navy-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <PriorityBadge priority={selectedWO.priority} />
                <span className="text-gray-400 text-xs capitalize">{selectedWO.type.replace('_', ' ')}</span>
                <span className="text-gray-400 text-xs capitalize">{selectedWO.status.replace('_', ' ')}</span>
              </div>
              <p className="text-gray-300 text-sm">{selectedWO.description}</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Assigned to', value: selectedWO.assignedTo ?? 'Unassigned' },
                  { label: 'Planned date', value: formatDate(selectedWO.plannedDate) },
                  { label: 'Estimated hours', value: `${selectedWO.estimatedHours}h` },
                  { label: 'Completed', value: selectedWO.completedDate ? formatDate(selectedWO.completedDate) : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-navy-700/50 rounded-[2px] p-3">
                    <p className="text-gray-500 text-xs">{label}</p>
                    <p className="text-white mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
              {selectedWO.partsRequired && selectedWO.partsRequired.length > 0 && (
                <div>
                  <p className="text-gray-400 text-xs mb-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Parts required
                  </p>
                  <ul className="space-y-1">
                    {selectedWO.partsRequired.map((part) => (
                      <li key={part} className="text-gray-300 text-sm flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" />
                        {part}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New work order modal */}
      {showModal && selectedVessel && (
        <NewWorkOrderModal
          vesselId={selectedVessel.id}
          onClose={() => setShowModal(false)}
          onSubmit={(data) => createWorkOrder(data)}
          isSubmitting={isCreating}
        />
      )}
    </>
  )
}
