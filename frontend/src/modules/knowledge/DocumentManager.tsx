import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Upload, FileText, Search, CheckCircle, Clock, AlertCircle, Database } from 'lucide-react'
import { useFleet } from '../../context/FleetContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { formatDate, toBackendVesselId } from '../../lib/utils'
import axios from 'axios'

interface KnowledgeDoc {
  id: string
  name: string
  type: string
  status: 'indexed' | 'processing' | 'error'
  uploadedAt: string
}

const DEMO_DOCS: KnowledgeDoc[] = [
  { id: '1', name: 'MAN B&W 6G80ME-C Main Engine Manual', type: 'Technical Manual', status: 'indexed', uploadedAt: new Date(Date.now() - 90 * 86400000).toISOString() },
  { id: '2', name: 'ABB Turbocharger Maintenance Instructions', type: 'Maintenance Manual', status: 'indexed', uploadedAt: new Date(Date.now() - 60 * 86400000).toISOString() },
  { id: '3', name: 'Class Survey Report 2024 — DNV', type: 'Survey Report', status: 'indexed', uploadedAt: new Date(Date.now() - 30 * 86400000).toISOString() },
  { id: '4', name: 'Previous Defect Reports 2024-2025', type: 'Defect Log', status: 'indexed', uploadedAt: new Date(Date.now() - 45 * 86400000).toISOString() },
  { id: '5', name: 'IMO MARPOL Consolidated Edition 2022', type: 'Regulation', status: 'indexed', uploadedAt: new Date(Date.now() - 120 * 86400000).toISOString() },
  { id: '6', name: 'Alfa Laval Fuel Oil Purifier Manual', type: 'Technical Manual', status: 'indexed', uploadedAt: new Date(Date.now() - 75 * 86400000).toISOString() },
  { id: '7', name: 'Emergency Response Manual 2025', type: 'Emergency Procedures', status: 'indexed', uploadedAt: new Date(Date.now() - 15 * 86400000).toISOString() },
  { id: '8', name: 'Cargo Handling Procedures Manual', type: 'Operations Manual', status: 'processing', uploadedAt: new Date(Date.now() - 2 * 86400000).toISOString() },
]

const STATUS_ICONS = {
  indexed: <CheckCircle size={14} className="text-green-400" />,
  processing: <Clock size={14} className="text-amber-400" />,
  error: <AlertCircle size={14} className="text-red-400" />,
}

const STATUS_LABELS = {
  indexed: 'Indexed',
  processing: 'Processing',
  error: 'Error',
}

const STATUS_COLORS = {
  indexed: 'badge-healthy',
  processing: 'badge-warning',
  error: 'badge-critical',
}

export default function DocumentManager() {
  const { selectedVessel } = useFleet()
  const [search, setSearch] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const { data: docs = DEMO_DOCS, isLoading } = useQuery({
    queryKey: ['knowledge-docs', selectedVessel?.id],
    queryFn: async () => {
      // Backend wraps the list in { vesselId, vessel, documents, summary }, not a bare array.
      const { data } = await axios.get<{ documents: KnowledgeDoc[] }>(`/api/knowledge/documents/${toBackendVesselId(selectedVessel?.id)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('vm_token')}` }
      })
      return data.documents
    },
    placeholderData: DEMO_DOCS,
  })

  const filtered = docs.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.type.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <div className="text-2xl font-bold text-teal-400">{docs.filter(d => d.status === 'indexed').length}</div>
          <div className="text-sm text-gray-400 mt-1">Indexed Documents</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-amber-400">{docs.filter(d => d.status === 'processing').length}</div>
          <div className="text-sm text-gray-400 mt-1">Processing</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-white">{docs.length}</div>
          <div className="text-sm text-gray-400 mt-1">Total Documents</div>
        </div>
      </div>

      {/* Upload area */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          isDragging ? 'border-teal-500 bg-teal-900/20' : 'border-navy-600 hover:border-navy-500'
        }`}
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => { e.preventDefault(); setIsDragging(false) }}
      >
        <Upload size={32} className="text-gray-500 mx-auto mb-3" />
        <p className="text-gray-300 font-medium">Drop documents here to add to knowledge base</p>
        <p className="text-gray-500 text-sm mt-1">Supports PDF, DOCX, TXT — manuals, reports, procedures</p>
        <button className="btn-secondary mt-4 text-sm">Browse Files</button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search knowledge base..."
          className="w-full bg-navy-800 border border-navy-700 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-teal-600"
        />
      </div>

      {/* Documents table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-navy-700 flex items-center gap-2">
          <Database size={16} className="text-teal-400" />
          <h3 className="font-semibold text-white">Vessel Knowledge Base</h3>
          <span className="ml-auto text-sm text-gray-400">{filtered.length} documents</span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="md" /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-700">
                <th className="text-left px-5 py-3 text-xs text-gray-400 font-medium">Document</th>
                <th className="text-left px-5 py-3 text-xs text-gray-400 font-medium">Type</th>
                <th className="text-left px-5 py-3 text-xs text-gray-400 font-medium">Status</th>
                <th className="text-left px-5 py-3 text-xs text-gray-400 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(doc => (
                <tr key={doc.id} className="border-b border-navy-700/50 hover:bg-navy-700/30 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <FileText size={16} className="text-teal-400 shrink-0" />
                      <span className="text-white text-sm">{doc.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-gray-400 text-sm">{doc.type}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[doc.status]}`}>
                      {STATUS_ICONS[doc.status]}
                      {STATUS_LABELS[doc.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-400 text-sm">{formatDate(doc.uploadedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
