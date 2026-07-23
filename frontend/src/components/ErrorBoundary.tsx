import { Component, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** When this value changes, the boundary resets (e.g. pass the route pathname). */
  resetKey?: string
}

interface State {
  error: Error | null
}

/** True for dynamic-import / code-split chunk failures, which a reload fixes. */
function isChunkLoadError(error: Error): boolean {
  const msg = `${error?.name ?? ''} ${error?.message ?? ''}`
  return (
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk [\d]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  )
}

/**
 * Catches render-time errors in the routed pages so one failing view shows a
 * recoverable card instead of unmounting the tree and blanking the whole app
 * (the shell — sidebar/topbar — stays intact). Chunk-load failures (stale hash
 * after a redeploy) are detected specifically and messaged as "needs a refresh".
 * A React error boundary must be a class component — there is no hook equivalent
 * for `getDerivedStateFromError`.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prevProps: Props) {
    // Reset the boundary when navigating to a different route.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const chunkError = isChunkLoadError(error)

    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 flex items-center justify-center border border-status-amber/50 rounded-[2px] mb-4">
          <AlertTriangle className="w-6 h-6 text-status-amber" />
        </div>
        <h3 className="text-white font-semibold text-lg">
          {chunkError ? 'This section needs a refresh' : 'Something went wrong'}
        </h3>
        <p className="text-gray-400 text-sm mt-2 max-w-sm">
          {chunkError
            ? 'A newer version of the app is available, or a module failed to load. Reload to continue.'
            : 'An unexpected error occurred while rendering this view.'}
        </p>
        {!chunkError && (
          <p className="text-gray-600 text-xs mt-3 font-mono max-w-md break-words">{error.message}</p>
        )}
        <button
          onClick={this.handleReload}
          className="mt-6 flex items-center gap-2 px-4 py-2 rounded-[2px] text-[12.5px] font-semibold border border-teal-600 text-teal-400 hover:bg-teal-600/10 transition-colors"
        >
          <RotateCw className="w-4 h-4" />
          Reload
        </button>
      </div>
    )
  }
}
