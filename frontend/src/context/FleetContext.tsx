import React, { createContext, useContext, useState, useEffect } from 'react'
import type { Vessel, Fleet } from '@/lib/types'
import { MOCK_VESSELS, MOCK_FLEET } from '@/lib/mockData'
import { useAuth } from './AuthContext'

// The backend's vessel/fleet shape (Prisma schema + mock fixtures) never
// matched the frontend's Vessel type — e.g. flat currentLat/currentLon/
// currentSpeed instead of a nested `position` object, `imoNumber` instead of
// `imo`. Reading the API response as-is left `selectedVessel.position`
// undefined, which crashed any screen touching `.position.lat` (CII tracker,
// live fleet map, port scheduling). Normalize once, here, so every consumer
// of useFleet() gets a real Vessel.
interface BackendVessel {
  id: string
  name: string
  imoNumber: string
  type: string
  flag: string
  builtYear: number
  dwt: number
  currentLat?: number
  currentLon?: number
  currentSpeed?: number
  status: string
  fleetId: string
}

function normalizeVessel(v: BackendVessel): Vessel {
  return {
    id: v.id,
    name: v.name,
    imo: v.imoNumber,
    type: v.type as Vessel['type'],
    flag: v.flag,
    yearBuilt: v.builtYear,
    grossTonnage: v.dwt,
    deadweightTonnage: v.dwt,
    status: v.status as Vessel['status'],
    position: {
      lat: v.currentLat ?? 0,
      lng: v.currentLon ?? 0,
      heading: 0,
      speed: v.currentSpeed ?? 0,
      timestamp: new Date().toISOString(),
    },
    fleetId: v.fleetId,
    // Not returned by /api/fleet (that's a compliance-domain concern served by
    // /api/compliance/*) — default to neutral values so KPI math doesn't NaN.
    ciiRating: 'C',
    fuelEfficiencyScore: 70,
  }
}

interface FleetContextType {
  vessels: Vessel[]
  selectedVessel: Vessel | null
  setSelectedVessel: (vessel: Vessel | null) => void
  fleet: Fleet | null
  isLoading: boolean
}

const FleetContext = createContext<FleetContextType | undefined>(undefined)

export function FleetProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [vessels, setVessels] = useState<Vessel[]>([])
  const [selectedVessel, setSelectedVessel] = useState<Vessel | null>(null)
  const [fleet, setFleet] = useState<Fleet | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!isAuthenticated) {
      setVessels([])
      setFleet(null)
      setSelectedVessel(null)
      setIsLoading(false)
      return
    }

    // Try real API, fall back to mock
    const loadFleet = async () => {
      try {
        const token = localStorage.getItem('vm_token')
        const res = await fetch('/api/fleet', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json() as { id: string; name: string; operator: string; vessels: BackendVessel[] }
          const normalizedVessels = data.vessels.map(normalizeVessel)
          setFleet({
            id: data.id,
            name: data.name,
            company: data.operator,
            vessels: normalizedVessels,
            totalVessels: normalizedVessels.length,
          })
          setVessels(normalizedVessels)
          if (normalizedVessels.length > 0) setSelectedVessel(normalizedVessels[0])
          return
        }
      } catch {
        // Fall back to mock
      }
      // Use mock data
      setFleet(MOCK_FLEET)
      setVessels(MOCK_VESSELS)
      setSelectedVessel(MOCK_VESSELS[0])
      setIsLoading(false)
    }

    void loadFleet()
    setIsLoading(false)
  }, [isAuthenticated])

  return (
    <FleetContext.Provider value={{ vessels, selectedVessel, setSelectedVessel, fleet, isLoading }}>
      {children}
    </FleetContext.Provider>
  )
}

export function useFleet() {
  const ctx = useContext(FleetContext)
  if (!ctx) throw new Error('useFleet must be used within FleetProvider')
  return ctx
}
