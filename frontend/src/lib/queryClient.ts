import { QueryClient } from '@tanstack/react-query'

// 24-hour cache — vessels at sea may be disconnected for extended periods
const GC_TIME = 1000 * 60 * 60 * 24

// Bump this whenever a persisted query's response shape changes.
// PersistQueryClient discards any cache whose buster differs, so a stale,
// wrong-shaped payload from an older build (e.g. a list endpoint cached as a
// `{ key: [...] }` envelope instead of the unwrapped array) can't rehydrate and
// crash a view — it's dropped and refetched fresh.
export const QUERY_CACHE_BUSTER = 'v2-unwrapped-lists'

// Storage key for the persisted cache (idb-keyval / IndexedDB). Exported so the
// logout path can delete the persisted copy, not just the in-memory one.
export const QUERY_CACHE_KEY = 'vm-query-cache'
export const QUERY_CACHE_MAX_AGE = GC_TIME

// A single QueryClient for the app. It lives in its own module rather than
// main.tsx so non-React callers — the logout path in AuthContext — can clear it
// without importing the entry point (which would be a cycle).
export const queryClient = new QueryClient({
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
