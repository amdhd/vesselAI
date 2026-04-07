import { useState, useEffect } from 'react'
import { offlineQueue } from '@/lib/offlineQueue'

interface NetworkStatus {
  isOnline: boolean
  pendingCount: number
  isSyncing: boolean
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(offlineQueue.count())
  const [isSyncing, setIsSyncing] = useState(false)

  const refreshCount = () => setPendingCount(offlineQueue.count())

  const flushQueue = async () => {
    const items = offlineQueue.getAll()
    if (items.length === 0) return
    setIsSyncing(true)
    const token = localStorage.getItem('vm_token')
    const BASE_URL = (import.meta.env.VITE_API_URL as string) || '/api'

    for (const item of items) {
      try {
        const res = await fetch(`${BASE_URL}${item.url}`, {
          method: item.method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: item.data ? JSON.stringify(item.data) : undefined,
        })
        if (res.ok || res.status < 500) {
          // Success or a client error (4xx) — remove from queue either way
          offlineQueue.remove(item.id)
        }
      } catch {
        // Still offline — stop and try later
        break
      }
    }
    setIsSyncing(false)
    refreshCount()
  }

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      flushQueue()
    }
    const handleOffline = () => setIsOnline(false)
    const handleQueueUpdate = () => refreshCount()

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('vm:queue-updated', handleQueueUpdate)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('vm:queue-updated', handleQueueUpdate)
    }
  }, [])

  return { isOnline, pendingCount, isSyncing }
}
