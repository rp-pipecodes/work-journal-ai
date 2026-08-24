import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/**
 * The last line before a blank window. A render that throws would otherwise
 * leave an empty webview with no way out and no devtools to ask why — this app
 * lives in the menu bar, so there is no address bar to reload from and no tab
 * to close.
 *
 * There are two ways out, cheapest first. Trying again re-renders the tree it
 * already has, which is enough whenever the failure was a passing one; a
 * failure that is not passing simply lands back here. Reloading rebuilds the
 * window from scratch, which every view can survive — each one reads the
 * journal from the SQLite file on mount, so nothing already captured lives in
 * the React tree that failed.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failure: Error | null }
> {
  state: { failure: Error | null } = { failure: null }

  static getDerivedStateFromError(failure: Error) {
    return { failure }
  }

  componentDidCatch(failure: Error, info: ErrorInfo) {
    // The console is the only place this can go: there is no reporting service,
    // and a window that has already failed is a poor place to write to disk.
    console.error('the window failed to render', failure, info.componentStack)
  }

  /** Drops the failure and lets the same tree render again. */
  reset = () => {
    this.setState({ failure: null })
  }

  render() {
    if (this.state.failure === null) {
      return this.props.children
    }

    return (
      <div
        role="alert"
        className="flex h-screen flex-col items-start justify-center gap-3 bg-background px-6 text-foreground"
      >
        <h1 className="type-title">This window stopped working.</h1>
        <p className="type-body text-muted-foreground">
          Nothing already captured has been lost — the journal is on disk, not in
          this window. Reloading rebuilds it from there.
        </p>
        <p className="font-mono type-meta text-muted-foreground">
          {this.state.failure.message}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={this.reset}>
            Try again
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Reload this window
          </Button>
        </div>
      </div>
    )
  }
}
