export interface QueuedMutation {
  id: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  url: string
  data?: unknown
  label: string // human-readable, e.g. "Create work order"
  timestamp: number
}

const QUEUE_KEY = 'vm_offline_queue'

export const offlineQueue = {
  getAll(): QueuedMutation[] {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
    } catch {
      return []
    }
  },

  add(item: Omit<QueuedMutation, 'id' | 'timestamp'>): void {
    const queue = this.getAll()
    queue.push({ ...item, id: crypto.randomUUID(), timestamp: Date.now() })
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
    window.dispatchEvent(new CustomEvent('vm:queue-updated'))
  },

  remove(id: string): void {
    const queue = this.getAll().filter((m) => m.id !== id)
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
    window.dispatchEvent(new CustomEvent('vm:queue-updated'))
  },

  count(): number {
    return this.getAll().length
  },
}
