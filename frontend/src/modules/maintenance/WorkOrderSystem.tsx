import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Plus, X, Calendar, User, Wrench, AlertCircle } from 'lucide-react'
import { useFleet } from '@/context/FleetContext'
import { maintenanceApi } from '@/lib/api'
import { MOCK_WORK_ORDERS } from '@/lib/mockData'
import type { Equipment, WorkOrder, WorkOrderStatus, WorkOrderPriority } from '@/lib/types'
import { formatDate, cn } from '@/lib/utils'
import { describeApiError } from '@/lib/apiError'
import Badge from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'

const COLUMNS: { id: WorkOrderStatus; label: string; color: string }[] = [
  { id: 'open', label: 'Open', color: 'text-status-red border-status-red' },
  { id: 'in_progress', label: 'In Progress', color: 'text-status-amber border-status-amber' },
  { id: 'completed', label: 'Completed', color: 'text-accent border-accent' },
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
      className="bg-paper-3/60 border border-rule-2 rounded-inner p-3 cursor-pointer hover:border-accent-hi/50 hover:bg-paper-3 transition-colors space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-ink text-xs font-medium leading-snug">{workOrder.title}</h4>
        <PriorityBadge priority={workOrder.priority} />
      </div>
      <p className="text-faint text-xs">{workOrder.equipmentName}</p>
      <div className="space-y-1 text-xs text-faint">
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
  const [equipmentId, setEquipmentId] = useState('')
  const [priority, setPriority] = useState<WorkOrderPriority>('medium')
  const [assignedTo, setAssignedTo] = useState('')
  const [plannedDate, setPlannedDate] = useState(() => new Date().toISOString().split('T')[0])
  const [estimatedHours, setEstimatedHours] = useState(4)

  // The catalogue the picker offers. A work order has to name an equipment by
  // id — the API validates it, and the board looks the name up from it — so the
  // form picks from the vessel's actual equipment rather than accepting any
  // typed string.
  const { data: equipment = [] } = useQuery<Equipment[]>({
    queryKey: ['equipment', vesselId],
    queryFn: () => maintenanceApi.getEquipment(vesselId),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const selected = equipment.find((eq) => eq.id === equipmentId)
    if (!selected) return
    onSubmit({
      title,
      description,
      equipmentId: selected.id,
      equipmentName: selected.name,
      // The API takes a full ISO datetime, but <input type="date"> yields a
      // bare YYYY-MM-DD, which the schema rejects.
      plannedDate: new Date(`${plannedDate}T00:00:00.000Z`).toISOString(),
      priority,
      assignedTo,
      estimatedHours,
      vesselId,
      status: 'open',
      type: 'corrective',
    })
  }

  return (
    <div className="fixed inset-0 bg-shade/60 z-50 flex items-center justify-center p-4">
      <div className="panel shadow-pop w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-rule">
          <h3 className="text-ink font-semibold">New Work Order</h3>
          <button onClick={onClose} className="p-1.5 rounded-inner text-muted hover:text-ink hover:bg-paper-3 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Work order title..."
              className="w-full bg-paper-3 border border-rule-2 rounded-inner px-3 py-2 text-ink text-sm focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Equipment</label>
            <select
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              className="w-full bg-paper-3 border border-rule-2 rounded-inner px-3 py-2 text-ink text-sm focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors"
              required
            >
              <option value="">Select equipment...</option>
              {equipment.map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the work to be done..."
              rows={3}
              className="w-full bg-paper-3 border border-rule-2 rounded-inner px-3 py-2 text-ink text-sm focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as WorkOrderPriority)}
                className="w-full bg-paper-3 border border-rule-2 rounded-inner px-3 py-2 text-ink text-sm focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Planned Date</label>
              <input
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
                className="w-full bg-paper-3 border border-rule-2 rounded-inner px-3 py-2 text-ink text-sm focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Assigned To</label>
              <input
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="Engineer name..."
                className="w-full bg-paper-3 border border-rule-2 rounded-inner px-3 py-2 text-ink text-sm focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1.5">Estimated Hours</label>
              <input
                type="number"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(Number(e.target.value))}
                min={1}
                max={200}
                className="w-full bg-paper-3 border border-rule-2 rounded-inner px-3 py-2 text-ink text-sm focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 transition-colors"
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
              {isSubmitting && <div className="w-4 h-4 border-2 border-light border-t-transparent rounded-full animate-spin" />}
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
  const toast = useToast()
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

  // Guard against a stale, non-array value rehydrating from the persisted cache
  // (see EquipmentGrid): `?? []` only covers nullish, so a wrong-typed object
  // would slip through and throw when filtered.
  const workOrderList: WorkOrder[] = Array.isArray(workOrders) ? workOrders : []

  const { mutate: createWorkOrder, isPending: isCreating } = useMutation({
    mutationFn: (data: Partial<WorkOrder>) => maintenanceApi.createWorkOrder(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['work-orders-all'] })
      setShowModal(false)
      toast.success('Work order created')
    },
    onError: (err) => {
      // The modal stays open. Closing it on failure dismissed the form and
      // returned the board unchanged, which reads as "saved" — the one outcome
      // the user must not be left believing.
      toast.error('Work order not created', describeApiError(err, 'The server rejected it. Try again.'))
    },
  })

  const getColumnOrders = (status: WorkOrderStatus) =>
    workOrderList.filter((wo) => wo.status === status)

  if (!selectedVessel) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <ClipboardList className="w-12 h-12 text-faint-2 mb-4" />
        <h3 className="text-ink font-semibold">No vessel selected</h3>
        <p className="text-muted text-sm mt-2">Select a vessel to view work orders</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => (
          <div key={col.id} className="card animate-pulse">
            <div className="h-5 bg-paper-3 rounded mb-4 w-1/2" />
            {[1, 2].map((i) => (
              <div key={i} className="h-24 bg-paper-3 rounded mb-3" />
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
          <p className="text-muted text-sm">{workOrderList.length} total work orders</p>
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
                  <span className="text-faint text-xs tabular-nums bg-paper-3 px-2 py-0.5 rounded-inner">
                    {orders.length}
                  </span>
                </div>
                {orders.length === 0 ? (
                  <div className="text-center py-6 text-faint-2 text-xs">No orders</div>
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
        <div className="fixed inset-0 bg-shade/60 z-50 flex items-center justify-center p-4">
          <div className="panel shadow-pop w-full max-w-lg">
            <div className="flex items-start justify-between p-5 border-b border-rule">
              <div>
                <h3 className="text-ink font-semibold">{selectedWO.title}</h3>
                <p className="text-muted text-sm mt-0.5">{selectedWO.equipmentName}</p>
              </div>
              <button onClick={() => setSelectedWO(null)} className="p-1.5 rounded-inner text-muted hover:text-ink hover:bg-paper-3 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <PriorityBadge priority={selectedWO.priority} />
                <span className="text-muted text-xs capitalize">{selectedWO.type.replace('_', ' ')}</span>
                <span className="text-muted text-xs capitalize">{selectedWO.status.replace('_', ' ')}</span>
              </div>
              <p className="text-ink-2 text-sm">{selectedWO.description}</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Assigned to', value: selectedWO.assignedTo ?? 'Unassigned' },
                  { label: 'Planned date', value: formatDate(selectedWO.plannedDate) },
                  { label: 'Estimated hours', value: `${selectedWO.estimatedHours}h` },
                  { label: 'Completed', value: selectedWO.completedDate ? formatDate(selectedWO.completedDate) : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-paper-3/50 rounded-inner p-3">
                    <p className="text-faint text-xs">{label}</p>
                    <p className="text-ink mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
              {selectedWO.partsRequired && selectedWO.partsRequired.length > 0 && (
                <div>
                  <p className="text-muted text-xs mb-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Parts required
                  </p>
                  <ul className="space-y-1">
                    {selectedWO.partsRequired.map((part) => (
                      <li key={part} className="text-ink-2 text-sm flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
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
