import { useEffect, useState, type ReactNode } from 'react'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { get, set, del } from 'idb-keyval'
import { useAuth } from './AuthContext'
import { createQueryClient, QUERY_CACHE_BUSTER, QUERY_CACHE_MAX_AGE } from '@/lib/queryClient'
import { currentSessionScope, queryCacheKey, sessionScope } from '@/lib/sessionData'

function SessionQueries({ scope, children }: { scope: string | null; children: ReactNode }) {
  const [client] = useState(createQueryClient)
  const [persister] = useState(() => createAsyncStoragePersister({
    key: scope ? queryCacheKey(scope) : 'vm-query-cache:anonymous',
    storage: {
      getItem: async (key) => {
        if (!scope || currentSessionScope() !== scope) return null
        const value = await get<string>(key)
        return currentSessionScope() === scope ? value ?? null : null
      },
      setItem: (key, value) => {
        if (!scope || currentSessionScope() !== scope) return Promise.resolve()
        return set(key, value)
      },
      removeItem: (key) => del(key),
    },
    throttleTime: 2000,
  }))

  useEffect(() => () => {
    void client.cancelQueries()
    client.clear()
  }, [client])

  return (
    <PersistQueryClientProvider client={client}
      persistOptions={{ persister, maxAge: QUERY_CACHE_MAX_AGE, buster: QUERY_CACHE_BUSTER }}>
      {children}
    </PersistQueryClientProvider>
  )
}

export function SessionDataProvider({ children }: { children: ReactNode }) {
  const { user, sessionId, isLoading } = useAuth()
  if (isLoading) return null
  const scope = user && sessionId ? sessionScope(user, sessionId) : null
  return <SessionQueries key={scope ?? 'anonymous'} scope={scope}>{children}</SessionQueries>
}
