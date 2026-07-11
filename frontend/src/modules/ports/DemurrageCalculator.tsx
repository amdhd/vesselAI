import { useState, useMemo } from 'react'
import { AlertTriangle, Clock, CheckCircle, Zap } from 'lucide-react'
import { MOCK_VESSELS, MOCK_PORT_CALLS } from '@/lib/mockData'
import { formatNumber } from '@/lib/utils'

const DEFAULT_CHARTER: Record<string, { laytimeAllowed: number; demurrageRate: number }> = {
  v1: { laytimeAllowed: 48, demurrageRate: 12000 },
  v2: { laytimeAllowed: 42, demurrageRate: 9000 },
  v3: { laytimeAllowed: 36, demurrageRate: 8500 },
}

export default function DemurrageCalculator() {
  const [selectedVesselId, setSelectedVesselId] = useState('v3')
  const [laytimeAllowed, setLaytimeAllowed] = useState(DEFAULT_CHARTER['v3'].laytimeAllowed)
  const [demurrageRate, setDemurrageRate] = useState(DEFAULT_CHARTER['v3'].demurrageRate)

  const portCall = MOCK_PORT_CALLS.find((pc) => pc.vesselId === selectedVesselId)

  const timeUsed = portCall?.layTimeUsed ?? 0
  const timeRemaining = Math.max(laytimeAllowed - timeUsed, 0)
  const overtime = Math.max(timeUsed - laytimeAllowed, 0)

  const status: 'onlaytime' | 'atrisk' | 'indemurrage' =
    overtime > 0 ? 'indemurrage' : timeRemaining <= 8 ? 'atrisk' : 'onlaytime'

  const estimatedDemurrage = useMemo(() => {
    if (overtime > 0) return (overtime / 24) * demurrageRate
    return 0
  }, [overtime, demurrageRate])

  const optimalSpeed = useMemo(() => {
    // Simple: if time remaining < 12, slow down slightly to let port clear
    if (timeRemaining > 24) return null
    return (12 + (timeRemaining / 24) * 1.5).toFixed(1)
  }, [timeRemaining])

  const handleVesselChange = (id: string) => {
    setSelectedVesselId(id)
    const defaults = DEFAULT_CHARTER[id] ?? { laytimeAllowed: 48, demurrageRate: 10000 }
    setLaytimeAllowed(defaults.laytimeAllowed)
    setDemurrageRate(defaults.demurrageRate)
  }

  const usedPct = Math.min((timeUsed / laytimeAllowed) * 100, 100)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Demurrage Calculator</h2>
        <p className="text-gray-400 text-sm mt-0.5">Per-vessel laytime and demurrage tracking</p>
      </div>

      {/* Alert for OSV Tenaga Satu */}
      {selectedVesselId === 'v3' && status !== 'onlaytime' && (
        <div className="flex items-center gap-3 bg-navy-800 border border-status-amber rounded-[2px] px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-status-amber flex-shrink-0" />
          <p className="text-status-amber text-sm">
            <strong>OSV Tenaga Satu</strong> — <span className="font-mono">{timeRemaining}</span> hours of laytime remaining at Fujairah.
            Estimated demurrage if delayed: <strong className="font-mono">${formatNumber(demurrageRate / 24 * 8)}</strong>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="card space-y-5">
          <h3 className="font-semibold text-white">Charter Party Details</h3>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Vessel</label>
            <select
              value={selectedVesselId}
              onChange={(e) => handleVesselChange(e.target.value)}
              className="w-full bg-[#12161a] border border-white/[0.1] rounded-[2px] px-3 py-2.5 text-white text-sm"
            >
              {MOCK_VESSELS.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>

          {portCall && (
            <div className="bg-navy-700/50 rounded-[2px] p-3 text-sm">
              <p className="text-gray-400 mb-1">Active Port Call</p>
              <p className="text-white font-medium">{portCall.portName}, {portCall.country}</p>
              <p className="text-gray-400 text-xs mt-0.5">
                Berth: {portCall.berthNumber ?? 'TBC'} · Status: {portCall.status}
              </p>
            </div>
          )}

          <div>
            <label className="flex justify-between text-sm text-gray-400 mb-2">
              <span>Laytime Allowed</span>
              <span className="text-white font-mono font-semibold">{laytimeAllowed} hours</span>
            </label>
            <input
              type="range"
              min={12}
              max={96}
              step={6}
              value={laytimeAllowed}
              onChange={(e) => setLaytimeAllowed(parseInt(e.target.value))}
              className="w-full accent-teal-500"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1 font-mono">
              <span>12h</span>
              <span>96h</span>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Demurrage Rate ($/day)</label>
            <input
              type="number"
              value={demurrageRate}
              onChange={(e) => setDemurrageRate(parseInt(e.target.value) || 0)}
              className="w-full bg-[#12161a] border border-white/[0.1] rounded-[2px] px-3 py-2.5 text-white text-sm font-mono"
            />
          </div>
        </div>

        {/* Results */}
        <div className="space-y-4">
          {/* Status */}
          <div className={`card flex items-center gap-4 ${
            status === 'indemurrage' ? 'border-status-red' :
            status === 'atrisk' ? 'border-status-amber' :
            'border-status-green'
          }`}>
            {status === 'indemurrage' && <AlertTriangle className="w-8 h-8 text-status-red flex-shrink-0" />}
            {status === 'atrisk' && <Clock className="w-8 h-8 text-status-amber flex-shrink-0" />}
            {status === 'onlaytime' && <CheckCircle className="w-8 h-8 text-status-green flex-shrink-0" />}
            <div>
              <p className="text-sm text-gray-400">Status</p>
              <p className={`font-semibold text-lg ${
                status === 'indemurrage' ? 'text-status-red' :
                status === 'atrisk' ? 'text-status-amber' :
                'text-status-green'
              }`}>
                {status === 'indemurrage' ? 'In Demurrage' : status === 'atrisk' ? 'At Risk' : 'On Laytime'}
              </p>
            </div>
          </div>

          {/* Laytime progress */}
          <div className="card">
            <p className="text-sm text-gray-400 mb-3">Laytime Progress</p>
            <div className="flex justify-between text-sm mb-2 font-mono">
              <span className="text-white">{timeUsed}h used</span>
              <span className="text-gray-400">{laytimeAllowed}h allowed</span>
            </div>
            <div className="w-full bg-navy-700 h-[5px]">
              <div
                className={`h-[5px] transition-all ${
                  usedPct >= 100 ? 'bg-status-red' : usedPct >= 80 ? 'bg-status-amber' : 'bg-status-green'
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <p className="text-xs text-gray-400">Time Remaining</p>
                <p className={`font-mono text-2xl font-semibold ${timeRemaining <= 8 ? 'text-status-amber' : 'text-white'}`}>
                  {timeRemaining}h
                </p>
              </div>
              {overtime > 0 && (
                <div>
                  <p className="text-xs text-gray-400">Overtime</p>
                  <p className="font-mono text-2xl font-semibold text-status-red">{overtime}h</p>
                </div>
              )}
            </div>
          </div>

          {/* Financial */}
          <div className="grid grid-cols-2 gap-3">
            <div className="card">
              <p className="text-xs text-gray-400">Est. Demurrage</p>
              <p className={`font-mono text-xl font-semibold mt-1 ${estimatedDemurrage > 0 ? 'text-status-red' : 'text-status-green'}`}>
                ${formatNumber(estimatedDemurrage)}
              </p>
              {estimatedDemurrage === 0 && <p className="text-xs text-status-green mt-0.5">None accrued</p>}
            </div>
            <div className="card">
              <p className="text-xs text-gray-400">Rate per hour</p>
              <p className="font-mono text-xl font-semibold text-white mt-1">
                ${formatNumber(demurrageRate / 24)}
              </p>
            </div>
          </div>

          {/* Optimal speed recommendation */}
          {optimalSpeed && (
            <div className="card bg-navy-800 border-teal-600/50 flex items-start gap-3">
              <Zap className="w-5 h-5 text-teal-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-teal-400">Speed Recommendation</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Optimal speed to avoid demurrage:{' '}
                  <span className="text-white font-mono font-semibold">{optimalSpeed} kn</span>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
