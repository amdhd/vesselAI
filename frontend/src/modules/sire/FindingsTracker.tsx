import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle, Clock, ChevronDown, ChevronUp, Filter } from 'lucide-react'
import { useFleet } from '../../context/FleetContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { formatDate, toBackendVesselId } from '../../lib/utils'
import axios from 'axios'

interface Finding {
  id: string
  chapter: string
  finding: string
  severity: 'observation' | 'non-conformance'
  status: 'open' | 'closed'
  correctiveAction: string | null
  dueDate: string | null
  createdAt: string
}

type StatusFilter = 'all' | 'open' | 'closed'
type SeverityFilter = 'all' | 'observation' | 'non-conformance'

const SEVERITY_CLASS = {
  'observation': 'badge-warning',
  'non-conformance': 'badge-critical',
}

const STATUS_ICON = {
  open: <AlertTriangle size={14} className="text-amber-400" />,
  closed: <CheckCircle size={14} className="text-green-400" />,
}

export default function FindingsTracker() {
  const { selectedVessel } = useFleet()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: findings = [], isLoading } = useQuery<Finding[]>({
    queryKey: ['sire-findings', selectedVessel?.id],
    queryFn: async () => {
      const { data } = await axios.get(`/api/sire/findings/${toBackendVesselId(selectedVessel?.id)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('vm_token')}` }
      })
      return data
    },
  })

  const filtered = findings.filter(f =>
    (statusFilter === 'all' || f.status === statusFilter) &&
    (severityFilter === 'all' || f.severity === severityFilter)
  )

  const openCount = findings.filter(f => f.status === 'open').length
  const closedCount = findings.filter(f => f.status === 'closed').length
  const ncCount = findings.filter(f => f.severity === 'non-conformance').length

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card text-center">
          <div className={`text-2xl font-bold ${openCount > 0 ? 'text-amber-400' : 'text-green-400'}`}>{openCount}</div>
          <div className="text-xs text-gray-400 mt-1">Open</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-green-400">{closedCount}</div>
          <div className="text-xs text-gray-400 mt-1">Closed</div>
        </div>
        <div className="card text-center">
          <div className={`text-2xl font-bold ${ncCount > 0 ? 'text-red-400' : 'text-green-400'}`}>{ncCount}</div>
          <div className="text-xs text-gray-400 mt-1">Non-Conformances</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-white">{findings.length}</div>
          <div className="text-xs text-gray-400 mt-1">Total Findings</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-500" />
          <span className="text-xs text-gray-500">Status:</span>
          {(['all', 'open', 'closed'] as StatusFilter[]).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${statusFilter === f ? 'bg-teal-600 border-teal-600 text-white' : 'border-navy-600 text-gray-400 hover:text-white'}`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Severity:</span>
          {(['all', 'observation', 'non-conformance'] as SeverityFilter[]).map(f => (
            <button key={f} onClick={() => setSeverityFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${severityFilter === f ? 'bg-teal-600 border-teal-600 text-white' : 'border-navy-600 text-gray-400 hover:text-white'}`}>
              {f === 'all' ? 'All' : f === 'non-conformance' ? 'Non-Conformance' : 'Observation'}
            </button>
          ))}
        </div>
      </div>

      {/* Findings list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><LoadingSpinner size="md" /></div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <CheckCircle size={40} className="text-green-400 mx-auto mb-3" />
          <p className="text-gray-400">No findings match the current filter</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(finding => (
            <div key={finding.id} className={`card border ${finding.status === 'open' && finding.severity === 'non-conformance' ? 'border-red-800/60' : 'border-navy-700'}`}>
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedId(expandedId === finding.id ? null : finding.id)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {STATUS_ICON[finding.status]}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-teal-400 font-medium">{finding.chapter}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${SEVERITY_CLASS[finding.severity]}`}>
                        {finding.severity === 'non-conformance' ? 'Non-Conformance' : 'Observation'}
                      </span>
                      {finding.status === 'closed' && (
                        <span className="badge-healthy text-xs">Closed</span>
                      )}
                    </div>
                    <p className="text-white text-sm mt-1 truncate">{finding.finding}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 ml-4 shrink-0">
                  {finding.dueDate && finding.status === 'open' && (
                    <div className="text-right">
                      <div className="text-xs text-gray-500">Due</div>
                      <div className={`text-xs ${new Date(finding.dueDate) < new Date() ? 'text-red-400' : 'text-amber-400'}`}>
                        {formatDate(finding.dueDate)}
                      </div>
                    </div>
                  )}
                  {expandedId === finding.id ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                </div>
              </div>

              {expandedId === finding.id && (
                <div className="mt-4 pt-4 border-t border-navy-700 space-y-3">
                  <div>
                    <h4 className="text-xs text-gray-400 mb-1">Finding Detail</h4>
                    <p className="text-gray-300 text-sm">{finding.finding}</p>
                  </div>
                  {finding.correctiveAction && (
                    <div>
                      <h4 className="text-xs text-gray-400 mb-1">Corrective Action</h4>
                      <p className="text-gray-300 text-sm">{finding.correctiveAction}</p>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Clock size={12} /> Raised {formatDate(finding.createdAt)}
                    </span>
                    {finding.status === 'open' && (
                      <button className="text-xs btn-primary py-1.5 px-3">Mark as Closed</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
