/**
 * React Error Boundary (AP4): Ein Render-Fehler in einer Komponente führte
 * bisher zur weißen App — window.onerror fängt Render-Throws nicht. Die
 * Boundary zeigt stattdessen eine DS-konforme Fehleransicht, meldet den Fehler
 * ins lokale Log (Bridge, best effort) und bietet Neu-Laden + Logs-Zugriff.
 *
 * Einsatz: app-weit um <App/> (main.tsx) und pro Panel in der Workbench —
 * ein Panel-Crash reißt so nicht die ganze Oberfläche mit.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Name des geschützten Bereichs (für Log + Anzeige), z. B. „Chat". */
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
        <p className="error-boundary__title">Hier ist etwas schiefgelaufen.</p>
        <p className="error-boundary__message">{this.state.error.message}</p>
        <div className="error-boundary__actions">
          <button type="button" className="btn" onClick={this.#openLogs}>
            Logs-Ordner öffnen
          </button>
          <button type="button" className="btn btn--primary" onClick={this.#reset}>
            Neu laden
          </button>
        </div>
      </div>
    );
  }
}
