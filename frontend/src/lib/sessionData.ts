import { del } from 'idb-keyval'

export const SESSION_CLEARED_EVENT = 'vm:session-cleared'
export const LEGACY_QUERY_CACHE_KEY = 'vm-query-cache'

export function sessionScope(user: { id: string; fleetId?: string | null }, sessionId: string): string {
  return `${encodeURIComponent(JSON.stringify([user.id, user.fleetId ?? null]))}:${sessionId}`
}

export function currentSessionScope(): string | null {
  const sessionId = localStorage.getItem('vm_session_id')
  const raw = localStorage.getItem('vm_user')
  if (!sessionId || !raw || !localStorage.getItem('vm_token')) return null
  try {
    const user = JSON.parse(raw) as { id?: string; fleetId?: string | null }
    return user.id ? sessionScope({ ...user, id: user.id }, sessionId) : null
  } catch {
    return null
  }
}

export function queryCacheKey(scope: string): string {
  return `${LEGACY_QUERY_CACHE_KEY}:${scope}`
}

// Credentials are removed synchronously so old requests and delayed persistence
// cannot borrow a replacement session while durable cleanup is still pending.
export async function clearSessionData(): Promise<void> {
  const scope = currentSessionScope()
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('vm_') || key.startsWith('vm-')) localStorage.removeItem(key)
  }
  window.dispatchEvent(new Event(SESSION_CLEARED_EVENT))
  await Promise.all([
    del(LEGACY_QUERY_CACHE_KEY),
    ...(scope ? [del(queryCacheKey(scope))] : []),
    ...(typeof caches !== 'undefined' ? [caches.delete('vm-api-cache')] : []),
  ])
}
