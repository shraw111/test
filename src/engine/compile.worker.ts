import * as esbuild from "esbuild-wasm";
import wasmURL from "esbuild-wasm/esbuild.wasm?url";
import { compile } from "./compile";
import type { Files } from "./types";

// Starting esbuild costs a few hundred ms (wasm download + compile), so do it
// as soon as the worker exists rather than on the first build.
const ready = esbuild.initialize({ wasmURL, worker: false });

self.onmessage = async (event: MessageEvent<{ id: number; files: Files }>) => {
  const { id, files } = event.data;
  await ready;
  const result = await compile(esbuild, files);
  self.postMessage({ id, result });
};
