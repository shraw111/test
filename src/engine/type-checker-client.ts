import type { Diagnostic, Files } from "./types";

/** Main-thread handle on the type-check worker. The worker (and TypeScript with it) is created on first use. */
export class TypeCheckerClient {
  private worker?: Worker;
  private nextId = 0;
  private pending = new Map<number, { resolve: (d: Diagnostic[]) => void; reject: (e: Error) => void }>();

  private start() {
    const worker = new Worker(new URL("./typecheck.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; diagnostics?: Diagnostic[]; error?: string }>) => {
      const entry = this.pending.get(event.data.id);
      this.pending.delete(event.data.id);
      if (event.data.error) entry?.reject(new Error(event.data.error));
      else entry?.resolve(event.data.diagnostics ?? []);
    };
    return worker;
  }

  check(files: Files): Promise<Diagnostic[]> {
    this.worker ??= this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, files });
    });
  }

  dispose() {
    this.worker?.terminate();
  }
}
