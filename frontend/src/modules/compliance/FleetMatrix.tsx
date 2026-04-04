import { useState } from 'react'
import { CheckCircle, XCircle, AlertCircle, Download, Grid } from 'lucide-react'
import { MOCK_VESSELS } from '@/lib/mockData'
import { getCIIBgColor } from '@/lib/utils'
import type { CIIRating } from '@/lib/types'

interface VesselCompliance {
  vesselId: string
  vesselName: string
  ciiRating: CIIRating
  etsStatus: 'compliant' | 'at_risk' | 'non_compliant'
  mrvFiled: boolean
  eexiValid: boolean
  soxCompliant: boolean
}

const FLEET_COMPLIANCE: VesselCompliance[] = [
  {
    vesselId: 'v1',
    vesselName: 'MV Merdeka Spirit',
    ciiRating: 'B',
    etsStatus: 'compliant',
    mrvFiled: true,
    eexiValid: true,
    soxCompliant: true,
  },
  {
    vesselId: 'v2',
    vesselName: 'MT Kerteh Venture',
    ciiRating: 'D',
    etsStatus: 'at_risk',
    mrvFiled: true,
    eexiValid: false,
    soxCompliant: true,
  },
  {
    vesselId: 'v3',
    vesselName: 'OSV Tenaga Satu',
    ciiRating: 'C',
    etsStatus: 'compliant',
    mrvFiled: false,
    eexiValid: true,
    soxCompliant: true,
  },
]

function StatusCell({ ok, label }: { ok: boolean | 'warn'; label?: string }) {
  if (ok === 'warn') {
    return (
      <div className="flex items-center justify-center gap-1">
        <AlertCircle className="w-4 h-4 text-amber-400" />
        <span className="text-xs text-amber-400">{label ?? 'At Risk'}</span>
      </div>
    )
  }
  if (ok) {
    return (
      <div className="flex items-center justify-center gap-1">
        <CheckCircle className="w-4 h-4 text-green-400" />
        <span className="text-xs text-green-400">{label ?? 'Valid'}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-center gap-1">
      <XCircle className="w-4 h-4 text-red-400" />
      <span className="text-xs text-red-400">{label ?? 'Required'}</span>
    </div>
  )
}

function ETSBadge({ status }: { status: VesselCompliance['etsStatus'] }) {
  if (status === 'compliant') return <StatusCell ok={true} label="Compliant" />
  if (status === 'at_risk') return <StatusCell ok="warn" label="At Risk" />
  return <StatusCell ok={false} label="Non-compliant" />
}

export default function FleetMatrix() {
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState(false)

  const fullCompliant = FLEET_COMPLIANCE.filter(
    (v) =>
      (v.ciiRating === 'A' || v.ciiRating === 'B' || v.ciiRating === 'C') &&
      v.etsStatus === 'compliant' &&
      v.mrvFiled &&
      v.eexiValid &&
      v.soxCompliant,
  ).length

  const requireAttention = FLEET_COMPLIANCE.length - fullCompliant

  const handleGenerateReport = () => {
    setGenerating(true)
    setTimeout(() => {
      setGenerating(false)
      setGenerated(true)
    }, 2000)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Fleet Compliance Matrix</h2>
          <p className="text-gray-400 text-sm mt-0.5">Overview of all vessels' compliance status</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-green-400 font-semibold">{fullCompliant} fully compliant</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <span className="text-amber-400 font-semibold">{requireAttention} require attention</span>
          </div>
        </div>
      </div>

      {/* Summary banner */}
      <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
        requireAttention > 0
          ? 'bg-amber-900/20 border-amber-700'
          : 'bg-green-900/20 border-green-700'
      }`}>
        <Grid className={`w-5 h-5 flex-shrink-0 ${requireAttention > 0 ? 'text-amber-400' : 'text-green-400'}`} />
        <p className={`text-sm font-medium ${requireAttention > 0 ? 'text-amber-300' : 'text-green-300'}`}>
          {fullCompliant} vessel{fullCompliant !== 1 ? 's' : ''} fully compliant,{' '}
          {requireAttention} require{requireAttention === 1 ? 's' : ''} attention
        </p>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700 bg-navy-900/50">
                <th className="text-left px-5 py-3 text-gray-400 font-medium">Vessel</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">CII Rating</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">ETS Status</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">MRV Filed</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">EEXI Valid</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">SOx Compliant</th>
              </tr>
            </thead>
            <tbody>
              {FLEET_COMPLIANCE.map((vessel, i) => {
                const v = MOCK_VESSELS.find((mv) => mv.id === vessel.vesselId)
                return (
                  <tr
                    key={vessel.vesselId}
                    className={`border-b border-navy-700/50 hover:bg-navy-700/30 transition-colors ${
                      i % 2 === 0 ? '' : 'bg-navy-900/20'
                    }`}
                  >
                    <td className="px-5 py-4">
                      <div>
                        <p className="font-medium text-white">{vessel.vesselName}</p>
                        <p className="text-xs text-gray-500">{v?.type ?? ''} — IMO {v?.imo ?? ''}</p>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span
                        className={`inline-flex items-center justify-center w-9 h-9 rounded-lg font-bold text-lg border ${getCIIBgColor(vessel.ciiRating)}`}
                      >
                        {vessel.ciiRating}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <ETSBadge status={vessel.etsStatus} />
                    </td>
                    <td className="px-4 py-4 text-center">
                      <StatusCell ok={vessel.mrvFiled} label={vessel.mrvFiled ? 'Filed' : 'Pending'} />
                    </td>
                    <td className="px-4 py-4 text-center">
                      <StatusCell ok={vessel.eexiValid} label={vessel.eexiValid ? 'Valid' : 'Required'} />
                    </td>
                    <td className="px-4 py-4 text-center">
                      <StatusCell ok={vessel.soxCompliant} label={vessel.soxCompliant ? 'Compliant' : 'Non-compliant'} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleGenerateReport}
          disabled={generating}
          className="btn-primary flex items-center gap-2"
        >
          {generating ? (
            <>
              <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Generate Fleet Report
            </>
          )}
        </button>
      </div>

      {generated && (
        <div className="bg-green-900/30 border border-green-700 rounded-xl px-4 py-3 text-green-300 text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          Fleet compliance report generated successfully. Download will start shortly.
        </div>
      )}
    </div>
  )
}
