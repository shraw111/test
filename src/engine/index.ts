import { Compiler } from "./compiler";
import { PreviewBridge } from "./preview-bridge";
import { TypeCheckerClient } from "./type-checker-client";
import type { CompileResult, Diagnostic, Files, PreviewEvent } from "./types";

export type { CompileResult, Diagnostic, Files, PreviewEvent } from "./types";
export { ALLOWED_IMPORTS } from "./compile";

export type EngineEvent =
  | { type: "compiling"; buildId: number }
  | { type: "compiled"; buildId: number; result: CompileResult }
  | { type: "typechecked"; buildId: number; diagnostics: Diagnostic[]; error?: string }
  | PreviewEvent;

export interface EngineOptions {
  /**
   * What to do with TypeScript errors in generated code.
   * - "report" (default): render anyway, report errors alongside. Right for a
   *   human typing in an editor.
   * - "block": do not render a build that has type errors; the last good build
   *   stays on screen. Right for model output, where errors go back to the
   *   model before anything renders.
   * - "off": skip type-checking (TypeScript is never even downloaded).
   */
  typeCheck?: "report" | "block" | "off";
}

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
  private typeChecker = new TypeCheckerClient();
  private bridge: PreviewBridge;
  private latest = 0;
  private listeners = new Set<(event: EngineEvent) => void>();

  constructor(iframe: HTMLIFrameElement, private options: EngineOptions = {}) {
    this.bridge = new PreviewBridge(iframe);
    this.bridge.subscribe((event) => this.emit(event));
  }

  async render(files: Files): Promise<CompileResult | undefined> {
    const buildId = ++this.latest;
    const mode = this.options.typeCheck ?? "report";
    this.emit({ type: "compiling", buildId });

    // Compile and type-check run in parallel in separate workers.
    const typed = mode === "off" ? undefined : this.typeCheck(buildId, files);
    const result = await this.compiler.compile(files);
    if (buildId !== this.latest) return undefined;
    this.emit({ type: "compiled", buildId, result });
    if (!result.ok) return result;

    if (mode === "block" && typed) {
      const diagnostics = await typed;
      if (buildId !== this.latest) return undefined;
      if (diagnostics.some((d) => d.severity === "error")) return result;
    }
    this.bridge.load(buildId, result.js, result.css);
    return result;
  }

  private async typeCheck(buildId: number, files: Files): Promise<Diagnostic[]> {
    try {
      const diagnostics = await this.typeChecker.check(files);
      if (buildId === this.latest) this.emit({ type: "typechecked", buildId, diagnostics });
      return diagnostics;
    } catch (error) {
      // A broken type-checker must never take the preview down with it.
      if (buildId === this.latest) {
        this.emit({ type: "typechecked", buildId, diagnostics: [], error: String(error) });
      }
      return [];
    }
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
    this.typeChecker.dispose();
    this.bridge.dispose();
    this.listeners.clear();
  }
}
