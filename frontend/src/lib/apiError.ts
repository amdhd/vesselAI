import axios from 'axios'

/**
 * The message to show a user for a failed API call.
 *
 * Two different failure shapes reach the UI, and each carries its useful
 * message somewhere else:
 *
 *   - axios requests (everything on `lib/api.ts`) reject with an AxiosError.
 *     The backend answers errors with `{ error: string }`, which lands on
 *     `error.response.data`.
 *   - The streaming consumers throw a plain Error built from the response body.
 *
 * Anything else — a transport failure, a non-JSON body, an HTML error page from
 * a proxy — has no message worth showing, so the caller's `fallback` wins.
 * `TypeError` is singled out because that is what `fetch` rejects with when the
 * request never left the browser, and "Failed to fetch" is not an explanation.
 */
export function describeApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const serverError = err.response?.data?.error
    return typeof serverError === 'string' && serverError ? serverError : fallback
  }

  if (err instanceof Error && !(err instanceof TypeError) && err.message) {
    return err.message
  }

  return fallback
}
