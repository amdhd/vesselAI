import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Upload, AlertTriangle, CheckCircle, Clock, Filter } from 'lucide-react'
import { useFleet } from '../../context/FleetContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { formatDate } from '../../lib/utils'
import axios from 'axios'

interface SireDoc {
  id: string
  name: string
  type: string
  category: string
  status: 'valid' | 'expiring-soon' | 'expired'
  expiryDate: string | null
  uploadedAt: string
}

type FilterType = 'all' | 'valid' | 'expiring-soon' | 'expired'

const STATUS_ICON = {
  valid: <CheckCircle size={14} className="text-green-400" />,
  'expiring-soon': <Clock size={14} className="text-amber-400" />,
  expired: <AlertTriangle size={14} className="text-red-400" />,
}

const STATUS_CLASS = {
  valid: 'badge-healthy',
  'expiring-soon': 'badge-warning',
  expired: 'badge-critical',
}

const STATUS_LABEL = {
  valid: 'Valid',
  'expiring-soon': 'Expiring Soon',
  expired: 'EXPIRED',
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.floor(diff / 86400000)
}

export default function DocumentVault() {
  const { selectedVessel } = useFleet()
  const [filter, setFilter] = useState<FilterType>('all')

  const { data: docs = [], isLoading } = useQuery<SireDoc[]>({
    queryKey: ['sire-docs', selectedVessel?.id],
    queryFn: async () => {
      const { data } = await axios.get(`/api/sire/documents/${selectedVessel?.id || 'vessel-001'}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
      return data
    },
  })

  const filtered = docs.filter(d => filter === 'all' || d.status === filter)
  const expiredCount = docs.filter(d => d.status === 'expired').length
  const expiringSoonCount = docs.filter(d => d.status === 'expiring-soon').length
  const validCount = docs.filter(d => d.status === 'valid').length

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center cursor-pointer" onClick={() => setFilter('valid')}>
          <div className="text-2xl font-bold text-green-400">{validCount}</div>
          <div className="text-sm text-gray-400 mt-1">Valid</div>
        </div>
        <div className={`card text-center cursor-pointer ${expiringSoonCount > 0 ? 'border-amber-800' : ''}`} onClick={() => setFilter('expiring-soon')}>
          <div className="text-2xl font-bold text-amber-400">{expiringSoonCount}</div>
          <div className="text-sm text-gray-400 mt-1">Expiring Soon</div>
        </div>
        <div className={`card text-center cursor-pointer ${expiredCount > 0 ? 'border-red-800' : ''}`} onClick={() => setFilter('expired')}>
          <div className="text-2xl font-bold text-red-400">{expiredCount}</div>
          <div className="text-sm text-gray-400 mt-1">Expired</div>
        </div>
      </div>

      {expiredCount > 0 && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-sm">
            <span className="font-semibold">{expiredCount} certificate{expiredCount > 1 ? 's' : ''} expired</span> — must be renewed before SIRE inspection.
          </p>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-2">
        <Filter size={14} className="text-gray-500" />
        {(['all', 'valid', 'expiring-soon', 'expired'] as FilterType[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === f ? 'bg-teal-600 border-teal-600 text-white' : 'border-navy-600 text-gray-400 hover:text-white'
            }`}
          >
            {f === 'all' ? 'All' : f === 'expiring-soon' ? 'Expiring' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="md" /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-700">
                <th className="text-left px-5 py-3 text-xs text-gray-400">Certificate</th>
                <th className="text-left px-5 py-3 text-xs text-gray-400">Category</th>
                <th className="text-left px-5 py-3 text-xs text-gray-400">Status</th>
                <th className="text-left px-5 py-3 text-xs text-gray-400">Expiry</th>
                <th className="text-left px-5 py-3 text-xs text-gray-400">Days Remaining</th>
                <th className="text-left px-5 py-3 text-xs text-gray-400">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(doc => {
                const days = daysUntil(doc.expiryDate)
                return (
                  <tr key={doc.id} className={`border-b border-navy-700/50 hover:bg-navy-700/30 transition-colors ${doc.status === 'expired' ? 'bg-red-900/10' : ''}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-teal-400 shrink-0" />
                        <span className="text-white text-sm">{doc.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-sm">{doc.category}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${STATUS_CLASS[doc.status]}`}>
                        {STATUS_ICON[doc.status]}
                        {STATUS_LABEL[doc.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-sm">
                      {doc.expiryDate ? formatDate(doc.expiryDate) : 'No expiry'}
                    </td>
                    <td className="px-5 py-3">
                      {days !== null ? (
                        <span className={`text-sm font-medium ${days < 0 ? 'text-red-400' : days < 60 ? 'text-amber-400' : 'text-green-400'}`}>
                          {days < 0 ? `${Math.abs(days)} days overdue` : `${days} days`}
                        </span>
                      ) : (
                        <span className="text-gray-600 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <button className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1">
                        <Upload size={12} /> Upload
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
