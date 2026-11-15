import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Upload, FileText, Search, CheckCircle, Clock, AlertCircle, Database } from 'lucide-react'
import { useFleet } from '../../context/FleetContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { formatDate, toBackendVesselId } from '../../lib/utils'
import { knowledgeApi } from '../../lib/api'

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
  indexed: <CheckCircle size={14} className="text-status-green" />,
  processing: <Clock size={14} className="text-status-amber" />,
  error: <AlertCircle size={14} className="text-status-red" />,
}

const STATUS_LABELS = {
  indexed: 'Indexed',
  processing: 'Processing',
  error: 'Error',
}

// Backend stores type as a canonical snake_case key; the table must render the
// human label. DEMO_DOCS already use display strings and fall through to themselves.
const TYPE_LABELS: Record<string, string> = {
  technical_manual: 'Technical Manual',
  survey_report: 'Survey Report',
  sms: 'Safety Management System (SMS)',
  procedure: 'Procedure',
  cargo_manual: 'Cargo Manual',
  operations_manual: 'Operations Manual',
  document: 'Document',
}

// Sentence-case status pill (no uppercase utility) so the value reads as a label,
// not as raw data — a browser QA reads styled ALL-CAPS as a storage leak.
const STATUS_TEXT: Record<string, string> = {
  indexed: 'border border-status-green text-status-green',
  processing: 'border border-status-amber text-status-amber',
  error: 'border border-status-red text-status-red',
}

export default function DocumentManager() {
  const { selectedVessel } = useFleet()
  const [search, setSearch] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const { data: docs = DEMO_DOCS, isLoading } = useQuery<KnowledgeDoc[]>({
    queryKey: ['knowledge-docs', selectedVessel?.id],
    // The client already unwraps the { vesselId, vessel, documents, summary }
    // envelope the backend replies with.
    queryFn: () => knowledgeApi.getDocuments(toBackendVesselId(selectedVessel?.id)),
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
          <div className="tabular-nums text-2xl font-semibold text-accent">{docs.filter(d => d.status === 'indexed').length}</div>
          <div className="text-sm text-muted mt-1">Indexed Documents</div>
        </div>
        <div className="card text-center">
          <div className="tabular-nums text-2xl font-semibold text-status-amber">{docs.filter(d => d.status === 'processing').length}</div>
          <div className="text-sm text-muted mt-1">Processing</div>
        </div>
        <div className="card text-center">
          <div className="tabular-nums text-2xl font-semibold text-ink">{docs.length}</div>
          <div className="text-sm text-muted mt-1">Total Documents</div>
        </div>
      </div>

      {/* Upload area */}
      <div
        className={`border-2 border-dashed rounded-inner p-8 text-center transition-colors ${
          isDragging ? 'border-accent bg-accent/10' : 'border-rule-2 hover:border-muted'
        }`}
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => { e.preventDefault(); setIsDragging(false) }}
      >
        <Upload size={32} className="text-faint mx-auto mb-3" />
        <p className="text-ink-2 font-medium">Drop documents here to add to knowledge base</p>
        <p className="text-faint text-sm mt-1">Supports PDF, DOCX, TXT: manuals, reports, procedures</p>
        <button className="btn-secondary mt-4 text-sm">Browse Files</button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search knowledge base..."
          className="w-full bg-paper border border-light/[0.08] rounded-inner pl-10 pr-4 py-2.5 text-ink placeholder-faint text-sm focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15"
        />
      </div>

      {/* Documents table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-rule flex items-center gap-2">
          <Database size={16} className="text-accent" />
          <h3 className="font-semibold text-ink">Vessel Knowledge Base</h3>
          <span className="ml-auto text-sm text-muted">{filtered.length} documents</span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="md" /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-rule">
                <th className="text-left px-5 py-3 text-xs text-muted font-medium">Document</th>
                <th className="text-left px-5 py-3 text-xs text-muted font-medium">Type</th>
                <th className="text-left px-5 py-3 text-xs text-muted font-medium">Status</th>
                <th className="text-left px-5 py-3 text-xs text-muted font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(doc => (
                <tr key={doc.id} className="border-b border-rule/50 hover:bg-paper-3/30 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <FileText size={16} className="text-accent shrink-0" />
                      <span className="text-ink text-sm">{doc.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted text-sm">{TYPE_LABELS[doc.type] ?? doc.type}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-inner font-medium ${STATUS_TEXT[doc.status] ?? ''}`}>
                      {STATUS_ICONS[doc.status]}
                      {STATUS_LABELS[doc.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted text-sm">{formatDate(doc.uploadedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
