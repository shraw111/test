# UI Builder: in-browser React preview

Renders React code in the user's browser with no server-side build. The browser compiles the files with esbuild-wasm in a web worker and runs them in a sandboxed iframe on a separate origin. React and the design system come from static files through an import map.

> Continuing this project? Read [HANDOFF.md](HANDOFF.md) first.

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
| `src/engine/typecheck.ts` | In-memory TypeScript environment (`@typescript/vfs`) that checks user files against the React and `@ds/ui` declarations. Only user files are reported on. |
| `src/engine/typecheck.worker.ts` | Runs the checker off the main thread. It is created on the first `render()`, so TypeScript and the type bundle are never on the critical path. |
| `src/Editor.tsx` | CodeMirror editor with syntax highlighting. It shows compile, type and runtime errors inline and in the gutter. |
| `scripts/build-types.mjs` | Packages React, the DS declarations (emitted from `ds/src`) and the TS lib files into `public/types.json`. |
| `src/engine/preview-bridge.ts` | postMessage protocol with the iframe. |
| `src/engine/index.ts` | `PreviewEngine`: compile, then load. The newest build wins, and a failed build keeps the last good one on screen. |
| `preview/runtime.js` | Inside the iframe: imports the bundle from a blob URL, renders it in an error boundary, and reports `rendered`, `runtime-error` and `console` messages. |
| `preview/index.html` | Template for the preview page. The build injects the import map and its CSP hash. |
| `cdn.config.json` | The import map. Its keys are the only packages generated code may import. |
| `scripts/build-cdn.mjs` | Builds `preview/dist`: React and ReactDOM as ESM sharing one React, the DS bundle and CSS, and the preview page. |
| `content/src/index.ts` | The `@aem/content` module generated code imports. Requests go to the app by `postMessage`. |
| `src/content/` | Content store, sample data, type generation, and the client for the server API. |
| `src/ContentPanel.tsx` | Paste-a-link, drafts, editing and Save to AEM. |
| `server/` | API server: parses AEM links, reads and creates fragments on Cloud Service or 6.5. Holds the credentials. |
| `ds/` | Stub design system (`@ds/ui`), standing in for the real one. |

### Guarantees (each covered by `tests/e2e`)

- **One React instance.** Every bundle keeps `react` external and the import map resolves it once, so hooks work in both generated code and DS components.
- **Isolation.** The iframe is sandboxed without `allow-same-origin`, so it gets an opaque origin: no access to the app's DOM, cookies or storage. CSP sets `connect-src 'none'`, so generated code cannot call the network.
- **Type errors are caught against the design system.** A wrong prop value (`variant="danger"`), a missing required prop or a bad import is reported with file, line and column. `PreviewEngine` takes `{ typeCheck }`:
  - `"report"` (default): render anyway and show the errors. Suited to a person typing.
  - `"block"`: don't render a build that has type errors; the last good build stays on screen. Suited to model output, which should be corrected before anything renders.
  - `"off"`: skip it entirely. TypeScript is never downloaded.

  The app accepts `?typeCheck=block` or `?typeCheck=off`.
- **Errors come back.** Compile errors come with file, line and column. Errors thrown on import, render errors, event-handler errors and unhandled rejections are all posted back, and so is console output.

## AEM content fragments

Generated code reads content through `@aem/content`:

```tsx
import { useFragment, useFragmentList } from "@aem/content";
const { data, loading, error } = useFragment("/content/dam/acme/summer-sale");
const banners = useFragmentList("HeroBanner");   // every fragment of a model
```

The preview iframe still has no network access. Each call is a `postMessage` to the builder app, which answers from its content store. The store holds three kinds of fragment:

| Source | Where it comes from |
|---|---|
| `sample` | Built-in sample data, so previews work with no AEM connection. |
| `aem` | Fetched from AEM when a user pastes a link to a fragment. |
| `draft` | Created in the builder. It lives in memory and is previewed live. |

**Types follow the content.** Each loaded fragment's fields give a TypeScript interface per model, and the type-checker sees them. A field the model doesn't have, or a fragment path that isn't loaded, is a type error. Loading new content re-checks the code.

**Flow A, paste a link.** Content tab, paste any link containing a `/content/dam/...` path (asset details, the 6.5 editor, the Experience Cloud shell, or a plain path), then Load. The server fetches it with its own credentials.

**Flow B, create a fragment.** "New draft" picks a model and builds the field shape from a loaded fragment of that model. "Duplicate as draft" copies any fragment. Edit the fields as JSON and the preview updates live. **Save to AEM** asks for confirmation, then creates the fragment in `AEM_TARGET_FOLDER`. It never overwrites an existing fragment. Saved fragments are unpublished.

A draft can only be saved if a fragment of its model has been loaded from AEM, because the real model path comes from there. Sample models can't be saved.

### Server configuration

The API server (`server/`) starts with `npm run dev`. It holds the credentials, so the browser and the preview never see them.

| Variable | Meaning |
|---|---|
| `AEM_BASE_URL` | Author instance, e.g. `https://author-p123-e456.adobeaemcloud.com` or `https://aem.corp.example:4502`. Unset means sample content only. |
| `AEM_FLAVOR` | `cloud` or `65`. Detected from the host (`*.adobeaemcloud.com` is cloud) if unset. |
| `AEM_TOKEN` | Bearer token (Cloud Service access token / service credential). |
| `AEM_USER`, `AEM_PASSWORD` | Basic auth, typically for 6.5. Used when `AEM_TOKEN` is unset. |
| `AEM_TARGET_FOLDER` | Where new fragments are saved, inside `/content/dam/`, e.g. `/content/dam/generated`. Unset means read-only. |

Both platforms are served through the Assets HTTP API (`/api/assets`, which maps to `/content/dam`); only authentication differs.

> **Not yet verified against a real AEM.** The client follows Adobe's documented Assets HTTP API and is tested against `tests/helpers/fake-aem.mjs`, which imitates both platforms' authentication, including a 6.5-style login redirect. Check the response shape and the create call against a real Cloud Service and a real 6.5 instance. In particular, fragment models are inferred from the fragment's fields rather than read from the model definition.

## Tests

```bash
npm test           # compiler unit tests (esbuild-wasm in Node)
npm run test:e2e   # Playwright against the real app, the preview origin and a fake AEM
```

## Deploying

- **App:** `npm run build` writes `dist/`.
- **Preview origin:** host `preview/dist/` on a **different origin**, for example `preview.example.com`. Send `Access-Control-Allow-Origin: *` (the sandboxed iframe's origin is `null`) and long-cache `/cdn/*`. Build the app with `VITE_PREVIEW_URL=https://preview.example.com/`.
- **Real design system:** have its CI publish an ESM bundle with React external, plus its CSS, to a versioned path. Then update `cdn.config.json`.

## Costs to know

Measured in headless Chromium against a local server:

| | Size | When it loads |
|---|---|---|
| esbuild.wasm | 14MB raw, 3.8MB gzipped | On page load, cached afterwards |
| TypeScript worker | 3.6MB raw | On the first `render()`, in parallel with compile |
| `types.json` | 4.5MB raw, 0.6MB gzipped | With the TypeScript worker |

- The preview is visible about 2.3s after load. It doesn't wait for type-checking, which finishes about 1.5s later on a cold load.
- Later type-checks take about 0.4s, because the environment is updated incrementally.
- Serve all of these with long cache headers.
