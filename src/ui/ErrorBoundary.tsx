import { Component, type ReactNode } from 'react'

// Last-resort guard for ANY uncaught render error — a code bug, a transient hot-reload, or (the
// original reason) a project that slipped into storage in a format we can't parse. Shows a recovery
// screen instead of a blank page. "Reload" just retries (touches nothing); "Clear saved project" is
// the escape hatch for the rare case where the stored project itself is what keeps crashing.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }

  reset = () => {
    for (const store of [sessionStorage, localStorage]) {
      try { for (const k of Object.keys(store)) if (k.startsWith('dropedit:')) store.removeItem(k) } catch { /* ignore */ }
    }
    location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>dropedit hit an unexpected error and stopped. Your files on disk are untouched.</p>
        <div className="crash-actions">
          <button onClick={() => location.reload()}>Reload</button>
          <button className="danger" onClick={this.reset}>Clear saved project &amp; reload</button>
        </div>
        <p className="crash-hint">Reloading usually recovers it. If it keeps landing here, the saved
          project itself may be unreadable — clearing it starts fresh (your downloaded/exported files
          aren’t affected).</p>
        <p className="crash-detail">{String(this.state.error.message || this.state.error)}</p>
      </div>
    )
  }
}
