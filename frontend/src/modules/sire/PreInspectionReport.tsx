import { useState } from 'react'
import { FileText, Zap, CheckCircle, Download, AlertTriangle, Shield } from 'lucide-react'
import { useFleet } from '../../context/FleetContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { printAsPdf } from '../../lib/pdfExport'
import axios from 'axios'

const STEPS = [
  'Analyzing maintenance records...',
  'Reviewing compliance data...',
  'Checking SIRE documents...',
  'Compiling findings...',
  'Generating report...',
]

interface ReportData {
  reportText: string
  priorityActions: string[]
  overallReadiness: string
  generatedAt: string
}

export default function PreInspectionReport() {
  const { selectedVessel } = useFleet()
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(-1)
  const [report, setReport] = useState<ReportData | null>(null)
  const [error, setError] = useState('')

  const generate = async () => {
    setLoading(true)
    setError('')
    setReport(null)

    // Animate steps
    for (let i = 0; i < STEPS.length; i++) {
      setStep(i)
      await new Promise(r => setTimeout(r, 700))
    }

    try {
      const { data } = await axios.post('/api/sire/generate-pre-inspection-report', {
        vesselId: selectedVessel?.id || 'vessel-001',
      }, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      setReport(data)
    } catch {
      setError('Failed to generate report. Please try again.')
    } finally {
      setLoading(false)
      setStep(-1)
    }
  }

  const readinessColor = report?.overallReadiness === 'READY'
    ? 'text-green-400' : report?.overallReadiness === 'ATTENTION REQUIRED'
    ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Shield size={18} className="text-teal-400" />
              SIRE Pre-Inspection Report Generator
            </h3>
            <p className="text-gray-400 text-sm mt-1">
              Aggregates data from all modules to generate a SIRE-format inspection readiness report
            </p>
            <p className="text-teal-400 text-sm mt-1 font-medium">
              Vessel: {selectedVessel?.name || 'MV Merdeka Spirit'}
            </p>
          </div>
          <button
            onClick={generate}
            disabled={loading}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            {loading ? <><LoadingSpinner size="sm" /> Generating...</> : <><Zap size={16} /> Generate Report</>}
          </button>
        </div>

        {/* Progress steps */}
        {loading && (
          <div className="mt-6 space-y-2">
            {STEPS.map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                {i < step ? (
                  <CheckCircle size={16} className="text-green-400 shrink-0" />
                ) : i === step ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-navy-600 shrink-0" />
                )}
                <span className={`text-sm ${i === step ? 'text-white' : i < step ? 'text-green-400' : 'text-gray-600'}`}>
                  {s}
                </span>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
            <AlertTriangle size={14} /> {error}
          </div>
        )}
      </div>

      {/* Report output */}
      {report && (
        <>
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-white">Pre-Inspection Report</h3>
                <p className="text-xs text-gray-500 mt-1">Generated {new Date(report.generatedAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-bold ${readinessColor}`}>{report.overallReadiness}</span>
                <button
                  onClick={() => printAsPdf(
                    `SIRE Pre-Inspection Report — ${selectedVessel?.name || 'MV Merdeka Spirit'}`,
                    report.reportText,
                  )}
                  className="btn-secondary text-xs flex items-center gap-1.5 py-1.5"
                >
                  <Download size={12} /> Download PDF
                </button>
              </div>
            </div>
            <pre className="text-gray-300 text-xs whitespace-pre-wrap font-mono bg-navy-900 rounded-lg p-4 max-h-96 overflow-y-auto leading-relaxed">
              {report.reportText}
            </pre>
          </div>

          <div className="card">
            <h3 className="font-semibold text-white mb-4">Priority Actions Before Inspection</h3>
            <div className="space-y-2">
              {report.priorityActions.map((action, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-navy-900 rounded-lg border border-navy-700">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    i === 0 ? 'bg-red-900 text-red-400' : i < 3 ? 'bg-amber-900 text-amber-400' : 'bg-navy-700 text-gray-400'
                  }`}>{i + 1}</span>
                  <span className="text-sm text-gray-300">{action}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!loading && !report && (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <FileText size={48} className="text-navy-600 mb-4" />
          <p className="text-gray-400 max-w-md">
            Click "Generate Report" to analyze all vessel data and create a comprehensive SIRE pre-inspection report
          </p>
        </div>
      )}
    </div>
  )
}
