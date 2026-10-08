import React, { createContext, useContext, useState, useEffect } from 'react'
import type { Vessel, Fleet } from '@/lib/types'
import { MOCK_VESSELS, MOCK_FLEET } from '@/lib/mockData'
import { fleetApi } from '@/lib/api'
import { useAuth } from './AuthContext'

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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      setVessels([])
      setFleet(null)
      setSelectedVessel(null)
      setError(null)
      setIsLoading(false)
      return
    }

    const loadFleet = async () => {
      try {
        // Through the shared client: it knows VITE_API_URL, attaches the token
        // and handles 401. The hand-rolled fetch here hardcoded '/api', so any
        // deployment serving the API from another origin never saw a fleet.
        const fleetData = await fleetApi.getFleet()
        setFleet(fleetData)
        setVessels(fleetData.vessels)
        if (fleetData.vessels.length > 0) setSelectedVessel(fleetData.vessels[0])
        setError(null)
      } catch {
        // Dev without a backend: fixtures keep the UI workable. Production must
        // never present fixtures as real fleet data — an operator acting on an
        // invented vessel is worse than an empty screen, so surface it instead.
        if (import.meta.env.DEV) {
          setFleet(MOCK_FLEET)
          setVessels(MOCK_VESSELS)
          setSelectedVessel(MOCK_VESSELS[0])
          setError(null)
        } else {
          setFleet(null)
          setVessels([])
          setSelectedVessel(null)
          setError('Could not load fleet data')
        }
      } finally {
        setIsLoading(false)
      }
    }

    void loadFleet()
  }, [isAuthenticated])

  return (
    <FleetContext.Provider value={{ vessels, selectedVessel, setSelectedVessel, fleet, isLoading }}>
      {error && (
        <div
          role="alert"
          className="fixed top-0 inset-x-0 z-50 bg-status-red/90 border-b border-status-red px-4 py-2 text-center text-sm text-white"
        >
          {error}
        </div>
      )}
      {children}
    </FleetContext.Provider>
  )
}

export function useFleet() {
  const ctx = useContext(FleetContext)
  if (!ctx) throw new Error('useFleet must be used within FleetProvider')
  return ctx
}
