import type { PreviewEvent } from "./types";

export type ContentHandler = (op: "get" | "list", args: Record<string, string>) => unknown | Promise<unknown>;

/** postMessage channel to the sandboxed preview iframe (see preview/runtime.js). */
export class PreviewBridge {
  private ready = false;
  private queued: { buildId: number; js: string; css: string } | null = null;
  private listeners = new Set<(event: PreviewEvent) => void>();
  private contentHandler?: ContentHandler;

  constructor(private iframe: HTMLIFrameElement) {
    window.addEventListener("message", this.onMessage);
  }

  private onMessage = (event: MessageEvent) => {
    // The iframe is sandboxed without allow-same-origin, so its origin is "null";
    // identify it by window reference instead.
    if (event.source !== this.iframe.contentWindow) return;
    const data = event.data as PreviewEvent & { source?: string };
    if (data?.source !== "ui-preview") return;

    const request = event.data as { type?: string; id: number; op: "get" | "list"; args: Record<string, string> };
    if (request.type === "content-request") {
      void this.answerContent(request);
      return;
    }

    if (data.type === "ready") {
      this.ready = true;
      if (this.queued) this.post(this.queued);
    }
    this.listeners.forEach((listener) => listener(data));
  };

  private async answerContent({ id, op, args }: { id: number; op: "get" | "list"; args: Record<string, string> }) {
    const reply = (body: object) => this.iframe.contentWindow?.postMessage({ type: "content-response", id, ...body }, "*");
    try {
      if (!this.contentHandler) throw new Error("No content source is connected.");
      reply({ ok: true, data: await this.contentHandler(op, args) });
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  setContentHandler(handler: ContentHandler) {
    this.contentHandler = handler;
  }

  /** Tells the preview that content changed so mounted hooks refetch. */
  notifyContentChanged() {
    if (this.ready) this.iframe.contentWindow?.postMessage({ type: "content-changed" }, "*");
  }

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
