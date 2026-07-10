import { useState } from 'react'
import { FileText, Zap, Copy, Download, AlertTriangle } from 'lucide-react'
import { useFleet } from '../../context/FleetContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { printAsPdf } from '../../lib/pdfExport'
import { toBackendVesselId } from '../../lib/utils'
import axios from 'axios'

const EQUIPMENT_LIST = [
  'Main Engine', 'Turbocharger #1', 'Turbocharger #2', 'Fuel Oil Purifier',
  'Lube Oil Purifier', 'Fresh Water Generator', 'Aux Engine #1', 'Aux Engine #2',
  'Steering Gear', 'Cargo Pump #1', 'Cargo Pump #2', 'Ballast Pump',
  'Bow Thruster', 'Emergency Generator', 'Air Compressor',
]

const SEVERITY_OPTIONS = [
  { value: 'minor', label: 'Minor — No immediate operational impact' },
  { value: 'moderate', label: 'Moderate — Reduced performance, monitor closely' },
  { value: 'serious', label: 'Serious — Operational impact, requires prompt attention' },
  { value: 'critical', label: 'Critical — Immediate safety or operational risk' },
]

interface DefectReportResult {
  reportText: string
  probableCause: string
  recommendedAction: string
  partsRequired: string
  urgency: string
}

export default function DefectReportGenerator() {
  const { selectedVessel } = useFleet()
  const [form, setForm] = useState({
    equipment: '',
    description: '',
    symptoms: '',
    conditions: '',
    severity: 'moderate',
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DefectReportResult | null>(null)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!form.equipment || !form.description || !form.symptoms) {
      setError('Please fill in Equipment, Description, and Symptoms.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const { data } = await axios.post('/api/knowledge/generate-defect-report', {
        vesselId: toBackendVesselId(selectedVessel?.id),
        ...form,
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem('vm_token')}` }
      })
      setResult(data)
    } catch {
      setError('Failed to generate report. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const copyReport = () => {
    if (result) {
      navigator.clipboard.writeText(result.reportText)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Form */}
      <div className="space-y-4">
        <div className="card">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <FileText size={16} className="text-teal-400" />
            Defect Information
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Equipment *</label>
              <select
                value={form.equipment}
                onChange={e => setForm(f => ({ ...f, equipment: e.target.value }))}
                className="w-full bg-navy-900 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600"
              >
                <option value="">Select equipment...</option>
                {EQUIPMENT_LIST.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Defect Description *</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="Describe the defect or failure observed..."
                className="w-full bg-navy-900 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600 resize-none placeholder-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Symptoms Observed *</label>
              <textarea
                value={form.symptoms}
                onChange={e => setForm(f => ({ ...f, symptoms: e.target.value }))}
                rows={3}
                placeholder="What symptoms are present? (vibration, noise, temperature, pressure, etc.)"
                className="w-full bg-navy-900 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600 resize-none placeholder-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Conditions When Occurred</label>
              <textarea
                value={form.conditions}
                onChange={e => setForm(f => ({ ...f, conditions: e.target.value }))}
                rows={2}
                placeholder="Load conditions, time of occurrence, recent work done..."
                className="w-full bg-navy-900 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600 resize-none placeholder-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Estimated Severity</label>
              <select
                value={form.severity}
                onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                className="w-full bg-navy-900 border border-navy-600 rounded-[2px] px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-600"
              >
                {SEVERITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-status-red text-sm bg-navy-800 border border-status-red rounded-[2px] px-3 py-2">
                <AlertTriangle size={14} /> {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? (
                <><LoadingSpinner size="sm" /> Generating AI Report...</>
              ) : (
                <><Zap size={16} /> Generate Defect Report with AI</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Result */}
      <div>
        {!result ? (
          <div className="card flex flex-col items-center justify-center h-full min-h-[400px] text-center">
            <FileText size={48} className="text-navy-600 mb-4" />
            <p className="text-gray-500">Fill in the form and click "Generate" to create a formal maritime defect report</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-white">Generated Defect Report</h3>
                <div className="flex gap-2">
                  <button onClick={copyReport} className="btn-secondary text-xs flex items-center gap-1.5 py-1.5">
                    <Copy size={12} /> Copy
                  </button>
                  <button
                    onClick={() => printAsPdf(
                      `Defect Report — ${form.equipment} — ${selectedVessel?.name || 'MV Merdeka Spirit'}`,
                      result.reportText,
                    )}
                    className="btn-secondary text-xs flex items-center gap-1.5 py-1.5"
                  >
                    <Download size={12} /> PDF
                  </button>
                </div>
              </div>
              <pre className="text-gray-300 text-xs whitespace-pre-wrap font-mono bg-navy-900 rounded-[2px] p-4 max-h-64 overflow-y-auto">
                {result.reportText}
              </pre>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="card">
                <h4 className="text-sm font-medium text-gray-400 mb-2">Probable Cause</h4>
                <p className="text-white text-sm">{result.probableCause}</p>
              </div>
              <div className="card">
                <h4 className="text-sm font-medium text-gray-400 mb-2">Urgency</h4>
                <span className={`badge-${result.urgency === 'critical' ? 'critical' : result.urgency === 'high' ? 'warning' : 'info'}`}>
                  {result.urgency?.toUpperCase()}
                </span>
              </div>
              <div className="card">
                <h4 className="text-sm font-medium text-gray-400 mb-2">Recommended Action</h4>
                <p className="text-white text-sm">{result.recommendedAction}</p>
              </div>
              <div className="card">
                <h4 className="text-sm font-medium text-gray-400 mb-2">Parts Required</h4>
                <p className="text-white text-sm">{result.partsRequired}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
