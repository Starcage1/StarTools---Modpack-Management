import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  copied: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, copied: false };
  private copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Renderer error boundary caught an error", error, info);
  }

  componentWillUnmount(): void {
    if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
  }

  private copyError = async (): Promise<void> => {
    const { error } = this.state;
    if (!error) return;
    try {
      const copied = await window.api.copyText(error.stack || error.message);
      if (!copied) throw new Error("The error details could not be copied.");
      this.setState({ copied: true });
      if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
      this.copiedTimeout = setTimeout(() => {
        this.setState({ copied: false });
        this.copiedTimeout = null;
      }, 1600);
    } catch (copyError) {
      console.error("Failed to copy renderer error", copyError);
    }
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] p-6 text-[var(--text-main)]">
        <section
          role="alert"
          className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl"
        >
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-zinc-400">
            The interface encountered an unexpected error. You can copy the
            details or reload the app.
          </p>
          <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-red-400">
            {error.stack || error.message}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Reload App
            </button>
            <button
              type="button"
              onClick={() => void this.copyError()}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition hover:border-cyan-400/60 hover:bg-cyan-300 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              {this.state.copied ? "Copied!" : "Copy Error"}
            </button>
          </div>
        </section>
      </main>
    );
  }
}

export default ErrorBoundary;
