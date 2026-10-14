import { QueryClient } from '@tanstack/react-query'

// 24-hour cache — vessels at sea may be disconnected for extended periods
const GC_TIME = 1000 * 60 * 60 * 24

// Bump this whenever a persisted query's response shape changes.
// PersistQueryClient discards any cache whose buster differs, so a stale,
// wrong-shaped payload from an older build (e.g. a list endpoint cached as a
// `{ key: [...] }` envelope instead of the unwrapped array) can't rehydrate and
// crash a view — it's dropped and refetched fresh.
export const QUERY_CACHE_BUSTER = 'v2-unwrapped-lists'

export const QUERY_CACHE_MAX_AGE = GC_TIME

// Each mounted login gets its own client so late results cannot enter a new
// account's cache, even when both accounts can access the same vessel.
export function createQueryClient() {
  return new QueryClient({
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
}
