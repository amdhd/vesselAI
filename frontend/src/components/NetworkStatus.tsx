import { WifiOff, RefreshCw, CheckCircle } from 'lucide-react'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { useEffect, useState } from 'react'

export default function NetworkStatus() {
  const { isOnline, pendingCount, isSyncing } = useNetworkStatus()
  const [justReconnected, setJustReconnected] = useState(false)

  useEffect(() => {
    if (isOnline && pendingCount === 0 && !isSyncing) {
      // Flash a brief "synced" message after coming back online
      setJustReconnected(true)
      const t = setTimeout(() => setJustReconnected(false), 3000)
      return () => clearTimeout(t)
    }
  }, [isOnline, pendingCount, isSyncing])

  if (isOnline && !isSyncing && pendingCount === 0 && !justReconnected) {
    return null
  }

  if (!isOnline) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg bg-amber-900/90 border border-amber-700 px-4 py-2 text-sm text-amber-100 shadow-lg backdrop-blur-sm">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span>
          Offline — showing cached data
          {pendingCount > 0 && `, ${pendingCount} write${pendingCount > 1 ? 's' : ''} queued`}
        </span>
      </div>
    )
  }

  if (isSyncing) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg bg-teal-900/90 border border-teal-700 px-4 py-2 text-sm text-teal-100 shadow-lg backdrop-blur-sm">
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
        <span>Syncing {pendingCount} pending item{pendingCount !== 1 ? 's' : ''}...</span>
      </div>
    )
  }

  if (justReconnected) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg bg-teal-900/90 border border-teal-700 px-4 py-2 text-sm text-teal-100 shadow-lg backdrop-blur-sm">
        <CheckCircle className="h-4 w-4 shrink-0" />
        <span>Back online — data synced</span>
      </div>
    )
  }

  return null
}
