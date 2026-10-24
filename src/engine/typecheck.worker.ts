// Loaded lazily (first type-check only): TypeScript is several MB and the
// type bundle is another ~4 MB, neither of which should delay the first preview.
import * as ts from "typescript";
import typesUrl from "/types.json?url";
import { TypeChecker } from "./typecheck";
import type { Files } from "./types";

let checker: Promise<TypeChecker> | undefined;

function getChecker() {
  checker ??= fetch(typesUrl)
    .then((r) => r.json() as Promise<Record<string, string>>)
    .then((typeFiles) => new TypeChecker(ts, typeFiles));
  return checker;
}

self.onmessage = async (event: MessageEvent<{ id: number; files: Files; ambient?: Record<string, string> }>) => {
  const { id, files, ambient } = event.data;
  try {
    const started = performance.now();
    const diagnostics = (await getChecker()).check(files, ambient);
    self.postMessage({ id, diagnostics, ms: Math.round(performance.now() - started) });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
