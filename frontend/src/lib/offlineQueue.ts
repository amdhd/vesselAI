export interface QueuedMutation {
  id: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  url: string
  data?: unknown
  label: string // human-readable, e.g. "Create work order"
  timestamp: number
  // Who created this write. The queue lives in localStorage, which is shared by
  // every session on the origin, so each entry records its owner and is only
  // ever replayed under that same user's token (see useNetworkStatus).
  userId: string | null
}

const QUEUE_KEY = 'vm_offline_queue'

// The signed-in user's id, as written to vm_user by AuthContext on login.
export function currentUserId(): string | null {
  try {
    const raw = localStorage.getItem('vm_user')
    return raw ? ((JSON.parse(raw) as { id?: string }).id ?? null) : null
  } catch {
    return null
  }
}

export const offlineQueue = {
  getAll(): QueuedMutation[] {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
    } catch {
      return []
    }
  },

  // Only the given user's entries. Replaying someone else's queued writes under
  // the current token would submit them as the wrong account.
  getAllFor(userId: string | null): QueuedMutation[] {
    if (!userId) return []
    return this.getAll().filter((m) => m.userId === userId)
  },

  add(item: Omit<QueuedMutation, 'id' | 'timestamp' | 'userId'>): void {
    const queue = this.getAll()
    queue.push({ ...item, userId: currentUserId(), id: crypto.randomUUID(), timestamp: Date.now() })
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
    window.dispatchEvent(new CustomEvent('vm:queue-updated'))
  },

  remove(id: string): void {
    const queue = this.getAll().filter((m) => m.id !== id)
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
    window.dispatchEvent(new CustomEvent('vm:queue-updated'))
  },

  countFor(userId: string | null): number {
    return this.getAllFor(userId).length
  },
}
