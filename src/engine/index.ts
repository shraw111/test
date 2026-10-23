import { Compiler } from "./compiler";
import { PreviewBridge } from "./preview-bridge";
import type { CompileResult, Files, PreviewEvent } from "./types";

export type { CompileResult, Diagnostic, Files, PreviewEvent } from "./types";
export { ALLOWED_IMPORTS } from "./compile";

export type EngineEvent =
  | { type: "compiling"; buildId: number }
  | { type: "compiled"; buildId: number; result: CompileResult }
  | PreviewEvent;

/**
 * Turns a set of source files into a running preview: compile in a worker,
 * then hand the bundle to the sandboxed iframe. Only the newest build wins;
 * a failed build leaves the last good one on screen.
 *
 * This is the surface a chat UI will drive later: call render() whenever the
 * model finishes writing files, and feed compile/runtime errors back to it.
 */
export class PreviewEngine {
  private compiler = new Compiler();
  private bridge: PreviewBridge;
  private latest = 0;
  private listeners = new Set<(event: EngineEvent) => void>();

  constructor(iframe: HTMLIFrameElement) {
    this.bridge = new PreviewBridge(iframe);
    this.bridge.subscribe((event) => this.emit(event));
  }

  async render(files: Files): Promise<CompileResult | undefined> {
    const buildId = ++this.latest;
    this.emit({ type: "compiling", buildId });
    const result = await this.compiler.compile(files);
    if (buildId !== this.latest) return undefined;
    this.emit({ type: "compiled", buildId, result });
    if (result.ok) this.bridge.load(buildId, result.js, result.css);
    return result;
  }

  /** Call before reloading the iframe so the next "ready" re-sends the latest build. */
  resetPreview() {
    this.bridge.reset();
  }

  subscribe(listener: (event: EngineEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: EngineEvent) {
    this.listeners.forEach((listener) => listener(event));
  }

  dispose() {
    this.compiler.dispose();
    this.bridge.dispose();
    this.listeners.clear();
  }
}
