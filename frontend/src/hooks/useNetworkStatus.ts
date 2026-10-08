import { useState, useEffect } from 'react'
import { offlineQueue, currentUserId } from '@/lib/offlineQueue'
import { replayQueuedMutation } from '@/lib/api'

interface NetworkStatus {
  isOnline: boolean
  pendingCount: number
  isSyncing: boolean
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(offlineQueue.countFor(currentUserId()))
  const [isSyncing, setIsSyncing] = useState(false)

  const refreshCount = () => setPendingCount(offlineQueue.countFor(currentUserId()))

  const flushQueue = async () => {
    // Only this user's queued writes. Entries left by a previous session on a
    // shared browser must not be replayed under the current user's token.
    const items = offlineQueue.getAllFor(currentUserId())
    if (items.length === 0) return
    setIsSyncing(true)

    for (const item of items) {
      const decision = await replayQueuedMutation(item)
      if (decision === 'drop') {
        offlineQueue.remove(item.id)
      } else if (decision === 'stop') {
        // Still offline, or the token was rejected. Leave every remaining entry
        // queued — including this one. A rejected token is transient, and the
        // queue is keyed per user, so the write replays under the same account
        // once they sign in again.
        break
      }
      // 'keep': the server failed on this one; leave it and try the next.
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
