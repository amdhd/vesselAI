import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker } from 'react-leaflet'
import L from 'leaflet'
import { useFleet } from '@/context/FleetContext'
import { MOCK_VESSELS } from '@/lib/mockData'
import { aisApi, type AisPosition } from '@/lib/api'
import type { Vessel } from '@/lib/types'
import { tok } from '@/lib/theme'
import { Anchor } from 'lucide-react'

// Fix leaflet default icon
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

function createVesselIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width: 32px;
      height: 32px;
      background: ${color};
      border: 3px solid ${tok('paper')};
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      box-shadow: 0 6px 16px -6px ${tok('shade', 0.8)};
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <svg style="transform: rotate(45deg)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${tok('accent-ink')}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></svg>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -34],
  })
}

// Vessel marker colors by status
function getVesselColor(vessel: Vessel): string {
  // OSV Tenaga Satu at risk (approaching demurrage)
  if (vessel.id === 'v3') return tok('apricot')
  // Others green
  return tok('accent')
}

// Mock destination coordinates
const DESTINATIONS: Record<string, [number, number]> = {
  v1: [1.3521, 103.8198],  // Singapore
  v2: [25.354, 56.36],     // Fujairah (already anchored)
  v3: [25.347, 56.342],    // Fujairah (in port)
}

const VOYAGE_INFO: Record<string, { speed: string; eta: string; status: string; voyage: string }> = {
  v1: { speed: '12.4 kn', eta: '20 Nov 2026 14:00', status: 'On Schedule', voyage: 'Kerteh → Singapore' },
  v2: { speed: '0 kn', eta: 'At Anchor', status: 'At Anchor', voyage: 'Fujairah Anchorage' },
  v3: { speed: '0 kn', eta: 'In Port', status: 'At Risk — Demurrage', voyage: 'Port of Fujairah T-14' },
}

export default function LiveFleetMap() {
  const { vessels } = useFleet()
  const displayVessels = vessels.length > 0 ? vessels : MOCK_VESSELS

  // Live AIS traffic from the aisstream ingestion — polled every 20s. Empty when
  // the stream/DB aren't running, in which case only the fleet markers show.
  const [aisVessels, setAisVessels] = useState<AisPosition[]>([])
  useEffect(() => {
    let active = true
    const load = () => {
      aisApi
        .getPositions()
        .then((p) => { if (active) setAisVessels(p) })
        .catch(() => { /* stream/DB not running — keep the demo layer only */ })
    }
    load()
    const id = setInterval(load, 20_000)
    return () => { active = false; clearInterval(id) }
  }, [])

  const aisLive = aisVessels.length > 0

  // Center on SE Asia / Middle East
  const center: [number, number] = [15.0, 82.0]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Live Fleet Map</h2>
          <p className="text-muted text-sm mt-0.5">Fleet vessels + live AIS traffic (aisstream)</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 ${aisLive ? 'bg-status-green animate-pulse' : 'bg-status-amber'}`} />
          <span className="text-xs text-muted">
            {aisLive ? `Live AIS · ${aisVessels.length} vessels` : 'Demo mode (AIS stream off)'}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-[7px] h-[7px] bg-status-green" />
          <span className="text-xs text-muted">Fleet, on schedule</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-[7px] h-[7px] bg-status-amber" />
          <span className="text-xs text-muted">Fleet, at risk of demurrage</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: tok('accent') }} />
          <span className="text-xs text-muted">Live AIS vessel</span>
        </div>
      </div>

      <div className="rounded-inner overflow-hidden border border-rule" style={{ height: '550px' }}>
        <MapContainer
          center={center}
          zoom={5}
          style={{ height: '100%', width: '100%' }}
          zoomControl={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />

          {/* Live AIS traffic — small dots, drawn beneath the fleet markers */}
          {aisVessels.map((v) => (
            <CircleMarker
              key={v.mmsi}
              center={[v.latitude, v.longitude]}
              radius={4}
              pathOptions={{ color: tok('accent-hi'), fillColor: tok('accent'), fillOpacity: 0.85, weight: 1 }}
            >
              <Popup>
                <div className="text-ink min-w-[180px]">
                  <p className="font-bold text-sm mb-1">{v.shipName || `MMSI ${v.mmsi}`}</p>
                  <div className="space-y-0.5 text-xs">
                    <div className="flex justify-between"><span className="text-ink-2">MMSI</span><span>{v.mmsi}</span></div>
                    <div className="flex justify-between"><span className="text-ink-2">Speed</span><span>{v.sog != null ? `${v.sog.toFixed(1)} kn` : '—'}</span></div>
                    <div className="flex justify-between"><span className="text-ink-2">Course</span><span>{v.cog != null ? `${Math.round(v.cog)}°` : '—'}</span></div>
                    <div className="flex justify-between"><span className="text-ink-2">Source</span><span className="text-accent">Live AIS</span></div>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {displayVessels.map((vessel) => {
            const color = getVesselColor(vessel)
            const icon = createVesselIcon(color)
            const info = VOYAGE_INFO[vessel.id]
            const dest = DESTINATIONS[vessel.id]

            return (
              <div key={vessel.id}>
                <Marker
                  position={[vessel.position.lat, vessel.position.lng]}
                  icon={icon}
                >
                  <Popup>
                    <div className="text-ink min-w-[200px]">
                      <p className="font-bold text-base mb-2">{vessel.name}</p>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-ink-2">Speed:</span>
                          <span className="font-medium">{info?.speed ?? `${vessel.position.speed} kn`}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-2">ETA:</span>
                          <span className="font-medium">{info?.eta ?? 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-2">Status:</span>
                          <span className={`font-medium ${
                            info?.status.includes('Risk') ? 'text-status-amber' : 'text-status-green'
                          }`}>
                            {info?.status ?? vessel.status}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-2">Voyage:</span>
                          <span className="font-medium text-right ml-2">{info?.voyage ?? 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-2">CII:</span>
                          <span className="font-medium">{vessel.ciiRating}</span>
                        </div>
                      </div>
                    </div>
                  </Popup>
                </Marker>

                {/* Route line to destination */}
                {dest && vessel.status === 'underway' && (
                  <Polyline
                    positions={[
                      [vessel.position.lat, vessel.position.lng],
                      dest,
                    ]}
                    color={color}
                    weight={2}
                    dashArray="6 4"
                    opacity={0.6}
                  />
                )}
              </div>
            )
          })}
        </MapContainer>
      </div>

      {/* Vessel quick status row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {displayVessels.map((v) => {
          const info = VOYAGE_INFO[v.id]
          const color = getVesselColor(v)
          return (
            <div key={v.id} className="card flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                style={{ backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)`, border: `1.5px solid ${color}` }}
              >
                <Anchor className="w-4 h-4" style={{ color }} strokeWidth={1.8} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-ink text-sm truncate">{v.name}</p>
                <p className="text-xs text-muted truncate">{info?.voyage}</p>
                <p className="text-xs mt-0.5" style={{ color }}>
                  {info?.status}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
