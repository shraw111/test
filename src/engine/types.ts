/** Project files keyed by path relative to the project root, e.g. "App.tsx", "components/Card.tsx". */
export type Files = Record<string, string>;

export interface Diagnostic {
  file?: string;
  line?: number;
  column?: number;
  message: string;
}

export type CompileResult =
  | { ok: true; js: string; css: string; warnings: Diagnostic[]; ms: number }
  | { ok: false; errors: Diagnostic[]; warnings: Diagnostic[]; ms: number };

export type PreviewEvent =
  | { type: "ready" }
  | { type: "rendered"; buildId: number }
  | { type: "runtime-error"; buildId: number; phase: string; message: string; stack: string }
  | { type: "console"; buildId: number; level: "log" | "info" | "warn" | "error"; text: string };
