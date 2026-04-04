import { useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet'
import L from 'leaflet'
import { useFleet } from '@/context/FleetContext'
import { MOCK_VESSELS } from '@/lib/mockData'
import type { Vessel } from '@/lib/types'

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
      border: 3px solid white;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="transform: rotate(45deg); font-size: 14px; margin-top: 2px;">&#9875;</div>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -34],
  })
}

// Vessel marker colors by status
function getVesselColor(vessel: Vessel): string {
  // OSV Tenaga Satu at risk (approaching demurrage)
  if (vessel.id === 'v3') return '#f59e0b'
  // Others green
  return '#22c55e'
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
  const [socketConnected] = useState(false)

  // Center on SE Asia / Middle East
  const center: [number, number] = [15.0, 82.0]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Live Fleet Map</h2>
          <p className="text-gray-400 text-sm mt-0.5">Real-time vessel positions and route tracking</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="text-xs text-gray-400">{socketConnected ? 'Live' : 'Demo mode'}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span className="text-xs text-gray-400">On Schedule</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-500" />
          <span className="text-xs text-gray-400">At Risk / Demurrage</span>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden border border-navy-700" style={{ height: '550px' }}>
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
                    <div className="text-white min-w-[200px]">
                      <p className="font-bold text-base mb-2">{vessel.name}</p>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-300">Speed:</span>
                          <span className="font-medium">{info?.speed ?? `${vessel.position.speed} kn`}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-300">ETA:</span>
                          <span className="font-medium">{info?.eta ?? 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-300">Status:</span>
                          <span className={`font-medium ${
                            info?.status.includes('Risk') ? 'text-amber-400' : 'text-green-400'
                          }`}>
                            {info?.status ?? vessel.status}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-300">Voyage:</span>
                          <span className="font-medium text-right ml-2">{info?.voyage ?? 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-300">CII:</span>
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
                style={{ backgroundColor: color + '33', border: `2px solid ${color}` }}
              >
                ⚓
              </div>
              <div className="min-w-0">
                <p className="font-medium text-white text-sm truncate">{v.name}</p>
                <p className="text-xs text-gray-400 truncate">{info?.voyage}</p>
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
