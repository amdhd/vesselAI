import { useQuery } from '@tanstack/react-query'
import { useFleet } from '../../context/FleetContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { toBackendVesselId } from '../../lib/utils'
import axios from 'axios'

interface Chapter {
  chapter: string
  name: string
  score: number
  status: 'green' | 'amber' | 'red'
  findings: number
}

interface ReadinessData {
  overallScore: number
  lastInspection: string
  nextInspection: string
  chapters: Chapter[]
  openFindings: number
  expiredDocuments: number
  summary: { criticalItems: number; warningItems: number; goodItems: number }
}

const STATUS_DOT = {
  green: 'bg-green-400',
  amber: 'bg-amber-400',
  red: 'bg-red-400',
}

const SCORE_COLOR = (score: number) => {
  if (score >= 75) return 'text-green-400'
  if (score >= 60) return 'text-amber-400'
  return 'text-red-400'
}

const SCORE_BAR = (score: number) => {
  if (score >= 75) return 'bg-green-500'
  if (score >= 60) return 'bg-amber-500'
  return 'bg-red-500'
}

function CircularScore({ score }: { score: number }) {
  const radius = 54
  const circ = 2 * Math.PI * radius
  const offset = circ - (score / 100) * circ
  const color = score >= 75 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative w-40 h-40 mx-auto">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#1e3a6e" strokeWidth="10" />
        <circle cx="60" cy="60" r={radius} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-white">{score}</span>
        <span className="text-xs text-gray-400">/100</span>
      </div>
    </div>
  )
}

export default function ReadinessScore() {
  const { selectedVessel } = useFleet()

  const { data, isLoading, error } = useQuery<ReadinessData>({
    queryKey: ['sire-readiness', selectedVessel?.id],
    queryFn: async () => {
      const { data } = await axios.get(`/api/sire/readiness-score/${toBackendVesselId(selectedVessel?.id)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('vm_token')}` }
      })
      return data
    },
  })

  if (isLoading) return <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
  if (error || !data) return <div className="text-center text-red-400 py-8">Failed to load readiness data</div>

  return (
    <div className="space-y-6">
      {/* Overall score */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card text-center">
          <h3 className="text-sm text-gray-400 mb-4">SIRE Readiness Score</h3>
          <CircularScore score={data.overallScore} />
          <p className={`mt-3 font-bold text-lg ${SCORE_COLOR(data.overallScore)}`}>
            {data.overallScore >= 75 ? 'READY FOR INSPECTION' : data.overallScore >= 60 ? 'ATTENTION REQUIRED' : 'NOT READY'}
          </p>
        </div>

        <div className="lg:col-span-2 grid grid-cols-2 gap-4">
          <div className="card">
            <div className="text-xs text-gray-400 mb-1">Open Findings</div>
            <div className={`text-3xl font-bold ${data.openFindings > 0 ? 'text-amber-400' : 'text-green-400'}`}>
              {data.openFindings}
            </div>
            <div className="text-xs text-gray-500 mt-1">require corrective action</div>
          </div>
          <div className="card">
            <div className="text-xs text-gray-400 mb-1">Expired Documents</div>
            <div className={`text-3xl font-bold ${data.expiredDocuments > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {data.expiredDocuments}
            </div>
            <div className="text-xs text-gray-500 mt-1">certificates expired</div>
          </div>
          <div className="card">
            <div className="text-xs text-gray-400 mb-1">Critical Chapters</div>
            <div className={`text-3xl font-bold ${data.summary.criticalItems > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {data.summary.criticalItems}
            </div>
            <div className="text-xs text-gray-500 mt-1">chapters need attention</div>
          </div>
          <div className="card">
            <div className="text-xs text-gray-400 mb-1">Good Standing</div>
            <div className="text-3xl font-bold text-green-400">{data.summary.goodItems}</div>
            <div className="text-xs text-gray-500 mt-1">of 8 chapters</div>
          </div>
        </div>
      </div>

      {/* Chapter breakdown */}
      <div className="card">
        <h3 className="font-semibold text-white mb-4">Chapter-by-Chapter Breakdown</h3>
        <div className="space-y-4">
          {data.chapters.map(ch => (
            <div key={ch.chapter}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT[ch.status]}`} />
                  <span className="text-sm text-white">{ch.chapter} — {ch.name}</span>
                  {ch.findings > 0 && (
                    <span className="text-xs bg-amber-900/50 text-amber-400 border border-amber-800 px-1.5 py-0.5 rounded">
                      {ch.findings} finding{ch.findings > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <span className={`text-sm font-bold ${SCORE_COLOR(ch.score)}`}>{ch.score}/100</span>
              </div>
              <div className="h-2 bg-navy-900 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${SCORE_BAR(ch.score)}`}
                  style={{ width: `${ch.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
