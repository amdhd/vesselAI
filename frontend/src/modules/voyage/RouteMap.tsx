import { useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { RouteOptimization } from '@/lib/types'

// Fix Leaflet default icon issue in Vite
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

interface RouteMapProps {
  routeData?: RouteOptimization
  vesselPosition?: [number, number]
}

function MapBoundsUpdater({ routeData }: { routeData?: RouteOptimization }) {
  const map = useMap()

  useEffect(() => {
    if (routeData) {
      const allWaypoints = [
        ...routeData.directRoute.waypoints.map((w) => [w.lat, w.lng] as [number, number]),
        ...routeData.aiRoute.waypoints.map((w) => [w.lat, w.lng] as [number, number]),
      ]
      if (allWaypoints.length > 0) {
        const bounds = L.latLngBounds(allWaypoints)
        map.fitBounds(bounds, { padding: [40, 40] })
      }
    }
  }, [routeData, map])

  return null
}

export default function RouteMap({ routeData, vesselPosition }: RouteMapProps) {
  const directPositions = routeData?.directRoute.waypoints.map((w) => [w.lat, w.lng] as [number, number]) ?? []
  const aiPositions = routeData?.aiRoute.waypoints.map((w) => [w.lat, w.lng] as [number, number]) ?? []

  const vesselIcon = L.divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;background:#14b8a6;border:2px solid white;border-radius:50%;box-shadow:0 0 8px #14b8a6"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })

  return (
    <MapContainer
      center={[4, 108]}
      zoom={5}
      style={{ height: '450px', borderRadius: '12px' }}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
        maxZoom={19}
      />

      {routeData && <MapBoundsUpdater routeData={routeData} />}

      {/* Direct route — dashed red */}
      {directPositions.length > 1 && (
        <Polyline
          positions={directPositions}
          pathOptions={{ color: '#ef4444', weight: 2, dashArray: '8 6', opacity: 0.7 }}
        />
      )}

      {/* AI route — solid teal */}
      {aiPositions.length > 1 && (
        <Polyline
          positions={aiPositions}
          pathOptions={{ color: '#14b8a6', weight: 2.5, opacity: 0.9 }}
        />
      )}

      {/* AI route waypoints with weather info */}
      {routeData?.aiRoute.waypoints.map((wp, idx) => (
        <CircleMarker
          key={`ai-wp-${idx}`}
          center={[wp.lat, wp.lng]}
          radius={5}
          pathOptions={{ color: '#14b8a6', fillColor: '#14b8a6', fillOpacity: 0.9, weight: 1.5 }}
        >
          <Popup>
            <div style={{ fontSize: '12px', minWidth: '140px' }}>
              {wp.name && <p style={{ fontWeight: 'bold', marginBottom: '4px' }}>{wp.name}</p>}
              <p>Wind: {wp.weather.windSpeed} kn</p>
              <p>Waves: {wp.weather.waveHeight}m</p>
              <p>Current: {wp.weather.current} kn</p>
              <p style={{ color: '#9ca3af', marginTop: '4px', fontSize: '11px' }}>{wp.weather.description}</p>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {/* Direct route waypoints */}
      {routeData?.directRoute.waypoints.map((wp, idx) => (
        <CircleMarker
          key={`dir-wp-${idx}`}
          center={[wp.lat, wp.lng]}
          radius={4}
          pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.6, weight: 1 }}
        >
          {wp.name && (
            <Popup>
              <div style={{ fontSize: '12px' }}>
                <p style={{ fontWeight: 'bold' }}>{wp.name}</p>
                <p style={{ color: '#9ca3af' }}>Direct route waypoint</p>
              </div>
            </Popup>
          )}
        </CircleMarker>
      ))}

      {/* Vessel position marker */}
      {vesselPosition && (
        <Marker position={vesselPosition} icon={vesselIcon}>
          <Popup>
            <div style={{ fontSize: '12px' }}>
              <p style={{ fontWeight: 'bold' }}>Vessel Position</p>
            </div>
          </Popup>
        </Marker>
      )}

      {/* Legend */}
    </MapContainer>
  )
}
