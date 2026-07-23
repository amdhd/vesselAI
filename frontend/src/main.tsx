/// <reference types="vite/client" />
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { get, set, del } from 'idb-keyval'
import App from './App'
import './index.css'

// 24-hour cache — vessels at sea may be disconnected for extended periods
const GC_TIME = 1000 * 60 * 60 * 24

// Bump this whenever a persisted query's response shape changes.
// PersistQueryClient discards any cache whose buster differs, so a stale,
// wrong-shaped payload from an older build (e.g. a list endpoint cached as a
// `{ key: [...] }` envelope instead of the unwrapped array) can't rehydrate and
// crash a view — it's dropped and refetched fresh.
const CACHE_BUSTER = 'v2-unwrapped-lists'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,   // 5 minutes before background refetch
      gcTime: GC_TIME,
      retry: (failureCount, error: unknown) => {
        // Don't retry on 4xx — retry up to 2x on network errors
        const status = (error as { response?: { status: number } })?.response?.status
        if (status && status >= 400 && status < 500) return false
        return failureCount < 2
      },
    },
  },
})

// Persist query cache in IndexedDB so it survives page reloads and offline sessions
const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get<string>(key).then((v) => v ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
  key: 'vm-query-cache',
  throttleTime: 2000,
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge: GC_TIME, buster: CACHE_BUSTER }}
      >
        <App />
      </PersistQueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
