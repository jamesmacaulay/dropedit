import { Component, type ReactNode } from 'react'

// Last-resort guard: if anything throws during render (e.g. a project in a format we can't parse
// that slipped into localStorage), show a recovery screen instead of a blank page — with a button
// that clears the saved project so a reload can't get stuck on the same bad data.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }

  reset = () => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('dropedit:')) localStorage.removeItem(k)
    } catch { /* ignore */ }
    location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>dropedit couldn’t open the current project — it may be in a format it can’t read. Your
          original files on disk are untouched.</p>
        <button onClick={this.reset}>Clear the saved project &amp; reload</button>
        <p className="crash-detail">{String(this.state.error.message || this.state.error)}</p>
      </div>
    )
  }
}
