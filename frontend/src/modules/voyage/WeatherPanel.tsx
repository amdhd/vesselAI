import { useEffect, useState, useCallback } from 'react'
import { CloudSun, Waves, Wind, Navigation2, RefreshCw, Loader2, MapPin } from 'lucide-react'
import { weatherApi, type LiveWeatherLocation } from '@/lib/api'

// WMO weather codes → short human labels (the subset Open-Meteo returns).
const WMO: Record<number, string> = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
  95: 'Thunderstorm', 96: 'Thunderstorm + hail', 99: 'Severe thunderstorm',
}

function weatherLabel(code?: number | null): string {
  if (code == null) return '—'
  return WMO[code] ?? `Code ${code}`
}

// Simple sea-state cue from wave height (Douglas scale-ish).
function seaState(waveM?: number | null): { label: string; color: string } {
  if (waveM == null) return { label: '—', color: 'text-[#767d88]' }
  if (waveM < 0.5) return { label: 'Calm', color: 'text-status-green' }
  if (waveM < 1.25) return { label: 'Smooth', color: 'text-status-green' }
  if (waveM < 2.5) return { label: 'Moderate', color: 'text-status-amber' }
  return { label: 'Rough', color: 'text-status-red' }
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-navy-700/40 rounded-[2px] p-2.5">
      <div className="flex items-center gap-1.5 text-[#767d88] text-[10.5px] uppercase tracking-wide mb-1">
        {icon}
        {label}
      </div>
      <p className="text-white font-mono font-semibold text-[15px]">{value}</p>
    </div>
  )
}

export default function WeatherPanel() {
  const [locations, setLocations] = useState<LiveWeatherLocation[] | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await weatherApi.getLive()
      setLocations(data.locations)
      setFetchedAt(data.fetchedAt)
    } catch {
      setError('Could not load live weather. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <CloudSun className="w-4 h-4 text-teal-400" />
            Live Marine Weather
          </h2>
          <p className="text-[#767d88] text-xs mt-1">
            Current conditions across the fleet's operating area — live from Open-Meteo Marine
            {fetchedAt && <> · updated {new Date(fetchedAt).toLocaleTimeString()}</>}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300 border border-teal-600/40 rounded-[2px] px-3 py-1.5 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      {error && <div className="card border-status-red text-status-red text-sm">{error}</div>}

      {loading && !locations && (
        <div className="card flex items-center justify-center py-12 text-gray-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Fetching live conditions…
        </div>
      )}

      {locations && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {locations.map((loc) => {
            const sea = seaState(loc.waveHeightM)
            return (
              <div key={loc.name} className="card">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-[#e2e4e7] font-semibold text-sm flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-teal-400" /> {loc.name}
                    </h3>
                    <p className="text-[#5c6470] text-[11px] font-mono mt-0.5">
                      {loc.latitude.toFixed(2)}, {loc.longitude.toFixed(2)}
                    </p>
                  </div>
                  {loc.ok ? (
                    <span className={`text-[11px] font-semibold ${sea.color}`}>{sea.label}</span>
                  ) : (
                    <span className="text-[11px] text-[#767d88]">unavailable</span>
                  )}
                </div>

                {loc.ok ? (
                  <>
                    <p className="text-[#a8adb5] text-xs mb-3">{weatherLabel(loc.weatherCode)}</p>
                    <div className="grid grid-cols-3 gap-2">
                      <Metric icon={<Waves className="w-3 h-3" />} label="Wave" value={loc.waveHeightM != null ? `${loc.waveHeightM.toFixed(1)}m` : '—'} />
                      <Metric icon={<Wind className="w-3 h-3" />} label="Wind" value={loc.windSpeedKn != null ? `${Math.round(loc.windSpeedKn)}kn` : '—'} />
                      <Metric icon={<Navigation2 className="w-3 h-3" />} label="Current" value={loc.currentSpeedKmh != null ? `${loc.currentSpeedKmh.toFixed(1)}` : '—'} />
                    </div>
                  </>
                ) : (
                  <p className="text-[#767d88] text-xs">No live data for this location right now.</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
