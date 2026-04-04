import React, { createContext, useContext, useState, useEffect } from 'react'
import type { Vessel, Fleet } from '@/lib/types'
import { MOCK_VESSELS, MOCK_FLEET } from '@/lib/mockData'
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
          const data = await res.json() as Fleet
          setFleet(data)
          setVessels(data.vessels)
          if (data.vessels.length > 0) setSelectedVessel(data.vessels[0])
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
