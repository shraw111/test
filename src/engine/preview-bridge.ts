import type { PreviewEvent } from "./types";

/** postMessage channel to the sandboxed preview iframe (see preview/runtime.js). */
export class PreviewBridge {
  private ready = false;
  private queued: { buildId: number; js: string; css: string } | null = null;
  private listeners = new Set<(event: PreviewEvent) => void>();

  constructor(private iframe: HTMLIFrameElement) {
    window.addEventListener("message", this.onMessage);
  }

  private onMessage = (event: MessageEvent) => {
    // The iframe is sandboxed without allow-same-origin, so its origin is "null";
    // identify it by window reference instead.
    if (event.source !== this.iframe.contentWindow) return;
    const data = event.data as PreviewEvent & { source?: string };
    if (data?.source !== "ui-preview") return;

    if (data.type === "ready") {
      this.ready = true;
      if (this.queued) this.post(this.queued);
    }
    this.listeners.forEach((listener) => listener(data));
  };

  private post(message: { buildId: number; js: string; css: string }) {
    this.queued = message;
    // Sandboxed opaque origin: "*" is the only targetOrigin that matches it.
    // The payload is code we are about to run there anyway; nothing secret.
    if (this.ready) this.iframe.contentWindow?.postMessage({ type: "load", ...message }, "*");
  }

  load(buildId: number, js: string, css: string) {
    this.post({ buildId, js, css });
  }

  /** Called when the iframe navigates (e.g. reload); waits for the next "ready". */
  reset() {
    this.ready = false;
  }

  subscribe(listener: (event: PreviewEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    window.removeEventListener("message", this.onMessage);
  }
}
