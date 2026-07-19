/**
 * React Error Boundary (AP4): a render error in a component previously led to a
 * blank white app — window.onerror doesn't catch render throws. The boundary
 * instead shows a DS-compliant error view, reports the error to the local log
 * (bridge, best effort), and offers reload + log access.
 *
 * Usage: app-wide around <App/> (main.tsx) and per panel in the Workbench —
 * a single panel crash then doesn't take the whole UI down with it.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Name of the protected area (for log + display), e.g. "Chat". */
  label: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const stack = [error.stack, info.componentStack]
      .filter((part): part is string => typeof part === 'string' && part !== '')
      .join('\n');
    void window.wab.logs
      .report({
        kind: 'error',
        message: `[ErrorBoundary:${this.props.label}] ${error.message}`,
        ...(stack !== '' ? { stack } : {}),
        source: 'react-error-boundary',
      })
      .catch(() => undefined);
  }

  readonly #reset = (): void => {
    this.setState({ error: null });
  };

  readonly #openLogs = (): void => {
    void window.wab.logs.openFolder().catch(() => undefined);
  };

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <p className="error-boundary__title">Something went wrong.</p>
        <p className="error-boundary__message">{this.state.error.message}</p>
        <div className="error-boundary__actions">
          <button type="button" className="btn" onClick={this.#openLogs}>
            Open logs folder
          </button>
          <button type="button" className="btn btn--primary" onClick={this.#reset}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
