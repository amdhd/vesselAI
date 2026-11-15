import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Zap, Copy, Clock, Download } from 'lucide-react'
import { useFleet } from '../../context/FleetContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { formatDateTime } from '../../lib/utils'
import { printAsPdf } from '../../lib/pdfExport'
import { toBackendVesselId } from '../../lib/utils'
import { describeApiError } from '../../lib/apiError'
import type { HandoverReport } from '../../lib/types'
import { knowledgeApi } from '../../lib/api'

const WATCH_OPTIONS = ['00-04 / 12-16', '04-08 / 16-20', '08-12 / 20-24']

interface HandoverRecord { id: string; watch: string; engineer: string; aiSummary: string; createdAt: string }

export default function ShiftHandover() {
  const { selectedVessel } = useFleet()
  const [form, setForm] = useState({
    watch: WATCH_OPTIONS[0],
    engineer: '',
    ongoingJobs: '',
    abnormalReadings: '',
    partsOnOrder: '',
    pendingOrders: '',
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<HandoverReport | null>(null)
  const [error, setError] = useState('')

  const { data: history = [] } = useQuery<HandoverRecord[]>({
    queryKey: ['handover-history', selectedVessel?.id],
    queryFn: () => Promise.resolve([
      { id: '1', watch: '00-04 / 12-16', engineer: '2nd Engineer Rahman', aiSummary: 'Main engine running normally at 82 RPM. Fuel purifier back-pressure slightly elevated at 3.8 bar, monitoring. Air compressor #2 isolated for overhaul — ETA 2 days. All standby equipment operational.', createdAt: new Date(Date.now() - 12 * 3600000).toISOString() },
      { id: '2', watch: '04-08 / 16-20', engineer: '3rd Engineer Siti', aiSummary: 'Turbocharger vibration noted at 4.2 mm/s — work order WO-2025-041 raised. Aux engine #2 switched to manual cooling, auto thermostat faulty. Parts ordered.', createdAt: new Date(Date.now() - 24 * 3600000).toISOString() },
    ]),
  })

  const handleGenerate = async () => {
    setLoading(true)
    setError('')
    try {
      // The client sends `engineer`, which is what the backend's HandoverSchema
      // requires — the old call posted it as `engineerName` alongside its own
      // hand-attached token, which is why it never went near the shared client.
      // `form.pendingOrders` is not sent: the schema has no such field.
      const report = await knowledgeApi.createHandover({
        vesselId: toBackendVesselId(selectedVessel?.id),
        watch: form.watch,
        engineer: form.engineer,
        ongoingJobs: form.ongoingJobs,
        abnormalReadings: form.abnormalReadings,
        partsOnOrder: form.partsOnOrder,
      })
      setResult(report)
    } catch (err) {
      // This used to synthesise a report on failure, ending with "Vessel in
      // normal operational condition" — a claim about the ship that no AI ever
      // made, in a document the watchkeeper signs and files. A failed handover
      // is now reported as failed.
      setResult(null)
      setError(describeApiError(err, 'Could not reach the handover service. Check your connection and try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="card">
          <h3 className="font-semibold text-ink mb-4 flex items-center gap-2">
            <ClipboardList size={16} className="text-accent" />
            End-of-Watch Handover
          </h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">Watch</label>
                <select value={form.watch} onChange={e => setForm(f => ({ ...f, watch: e.target.value }))}
                  className="w-full bg-paper border border-rule-2 rounded-inner px-3 py-2 text-ink text-sm focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15">
                  {WATCH_OPTIONS.map(w => <option key={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Engineer Name</label>
                <input value={form.engineer} onChange={e => setForm(f => ({ ...f, engineer: e.target.value }))}
                  placeholder="Your name" className="w-full bg-paper border border-rule-2 rounded-inner px-3 py-2 text-ink text-sm focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 placeholder-faint-2" />
              </div>
            </div>
            {[
              { key: 'ongoingJobs', label: 'Ongoing Jobs', placeholder: 'List all jobs in progress...' },
              { key: 'abnormalReadings', label: 'Abnormal Readings / Observations', placeholder: 'Any readings outside normal range...' },
              { key: 'partsOnOrder', label: 'Parts On Order', placeholder: 'Spares requisitioned, ETA...' },
              { key: 'pendingOrders', label: 'Pending Work Orders', placeholder: 'WO numbers and status...' },
            ].map(field => (
              <div key={field.key}>
                <label className="block text-xs text-muted mb-1">{field.label}</label>
                <textarea value={form[field.key as keyof typeof form]}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  rows={2} placeholder={field.placeholder}
                  className="w-full bg-paper border border-rule-2 rounded-inner px-3 py-2 text-ink text-sm focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15 resize-none placeholder-faint-2" />
              </div>
            ))}
            <button onClick={handleGenerate} disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2">
              {loading ? <><LoadingSpinner size="sm" /> Generating...</> : <><Zap size={16} /> Generate Handover Report</>}
            </button>
            {error && (
              <div role="alert" className="bg-critical/10 border border-critical/30 text-critical text-[13px] rounded-inner px-4 py-3">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {result ? (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-ink">Handover Report</h3>
              <div className="flex gap-2">
                <button onClick={() => navigator.clipboard.writeText(result.reportText)} className="btn-secondary text-xs flex items-center gap-1 py-1.5">
                  <Copy size={12} /> Copy
                </button>
                <button
                  onClick={() => printAsPdf(
                    `Watch Handover Report — ${form.watch} — ${selectedVessel?.name || 'MV Merdeka Spirit'}`,
                    result.reportText,
                  )}
                  className="btn-secondary text-xs flex items-center gap-1 py-1.5"
                >
                  <Download size={12} /> PDF
                </button>
              </div>
            </div>
            <div className="bg-accent/[0.06] border border-accent/30 rounded-inner p-3 mb-3">
              <p className="text-accent text-sm font-medium">Summary</p>
              <p className="text-ink-2 text-sm mt-1">{result.summary}</p>
            </div>
            <pre className="text-ink-2 text-xs whitespace-pre-wrap tabular-nums bg-paper rounded-inner p-3 max-h-64 overflow-y-auto">{result.reportText}</pre>
          </div>
        ) : (
          <div className="card flex items-center justify-center min-h-[200px] text-center text-faint">
            <div><ClipboardList size={40} className="mx-auto mb-3 text-rule-2" /><p>Fill the form to generate a handover report</p></div>
          </div>
        )}

        <div className="card">
          <h3 className="font-semibold text-ink mb-3 flex items-center gap-2"><Clock size={16} className="text-accent" /> Recent Handovers</h3>
          <div className="space-y-3">
            {history.map(h => (
              <div key={h.id} className="bg-paper rounded-inner p-3 border border-rule">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-ink text-sm font-medium">{h.engineer}</span>
                  <span className="text-xs text-faint">{formatDateTime(h.createdAt)}</span>
                </div>
                <span className="text-xs text-accent mb-1 block">Watch: {h.watch}</span>
                <p className="text-muted text-xs">{h.aiSummary}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
