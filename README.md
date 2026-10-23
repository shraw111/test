# UI Builder: in-browser React preview

Renders React code in the user's browser with no server-side build. The browser compiles the files with esbuild-wasm in a web worker and runs them in a sandboxed iframe on a separate origin. React and the design system come from static files through an import map.

This is the rendering engine. The chat that generates the code comes later and will drive `PreviewEngine.render(files)` (see [PLAN.md](PLAN.md)).

## Run it

```bash
npm install
npm run dev        # app on http://localhost:5180, preview origin on http://localhost:5181
```

Pick an example from the dropdown or edit the files. The preview rebuilds 250ms after you stop typing.

## How it works

```
editor files ──▶ compile.worker (esbuild-wasm) ──▶ postMessage ──▶ preview iframe (origin :5181)
                  │ in-memory files                                 import map: react, react-dom, @ds/ui
                  │ react / @ds/ui left external                    import(blob:) → render <App/>
                  └ other packages rejected                         errors + console ──▶ back to app
```

| File | Role |
|---|---|
| `src/engine/compile.ts` | Bundles the in-memory files. Allowlisted bare imports stay external and anything else is a compile error. |
| `src/engine/compile.worker.ts` | Runs `compile` inside esbuild-wasm off the main thread. |
| `src/engine/preview-bridge.ts` | postMessage protocol with the iframe. |
| `src/engine/index.ts` | `PreviewEngine`: compile, then load. The newest build wins, and a failed build keeps the last good one on screen. |
| `preview/runtime.js` | Inside the iframe: imports the bundle from a blob URL, renders it in an error boundary, and reports `rendered`, `runtime-error` and `console` messages. |
| `preview/index.html` | Template for the preview page. The build injects the import map and its CSP hash. |
| `cdn.config.json` | The import map. Its keys are the only packages generated code may import. |
| `scripts/build-cdn.mjs` | Builds `preview/dist`: React and ReactDOM as ESM sharing one React, the DS bundle and CSS, and the preview page. |
| `ds/` | Stub design system (`@ds/ui`), standing in for the real one. |

### Guarantees (each covered by `tests/e2e`)

- **One React instance.** Every bundle keeps `react` external and the import map resolves it once, so hooks work in both generated code and DS components.
- **Isolation.** The iframe is sandboxed without `allow-same-origin`, so it gets an opaque origin: no access to the app's DOM, cookies or storage. CSP sets `connect-src 'none'`, so generated code cannot call the network.
- **Errors come back.** Compile errors come with file, line and column. Errors thrown on import, render errors, event-handler errors and unhandled rejections are all posted back, and so is console output.

## Tests

```bash
npm test           # compiler unit tests (esbuild-wasm in Node)
npm run test:e2e   # Playwright against the real app + preview origin
```

## Deploying

- **App:** `npm run build` writes `dist/`.
- **Preview origin:** host `preview/dist/` on a **different origin**, for example `preview.example.com`. Send `Access-Control-Allow-Origin: *` (the sandboxed iframe's origin is `null`) and long-cache `/cdn/*`. Build the app with `VITE_PREVIEW_URL=https://preview.example.com/`.
- **Real design system:** have its CI publish an ESM bundle with React external, plus its CSS, to a versioned path. Then update `cdn.config.json`.

## Costs to know

esbuild.wasm is 14MB raw and 3.8MB gzipped. It downloads once and is then cached. On the first page load, esbuild initialisation plus the first build took about 1.2s in tests.
