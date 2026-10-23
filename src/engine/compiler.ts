import type { CompileResult, Files } from "./types";

/** Main-thread handle on the compile worker. */
export class Compiler {
  private worker = new Worker(new URL("./compile.worker.ts", import.meta.url), { type: "module" });
  private nextId = 0;
  private pending = new Map<number, (result: CompileResult) => void>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<{ id: number; result: CompileResult }>) => {
      this.pending.get(event.data.id)?.(event.data.result);
      this.pending.delete(event.data.id);
    };
  }

  compile(files: Files): Promise<CompileResult> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, files });
    });
  }

  dispose() {
    this.worker.terminate();
  }
}
