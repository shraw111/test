# UI Builder: Plan

A single-session chatbot. The user types a prompt, the LLM generates React files that use our design system, and the browser compiles, validates and previews them. The server only calls the LLM and stores history. Compiling, validating and rendering all happen client-side.

Decisions so far:

- Standalone project in its own repo (`ui-builder`). Everything is TypeScript: one npm workspace for the app, server, preview and design system.
- Targets a **stub design system** (`ds/`), built so the real one can be swapped in by changing a URL and a manifest.
- Generation goes through a small Node server using the official `openai` SDK. The same code supports OpenAI and Azure OpenAI, chosen by environment variables.
- esbuild-wasm route, not StackBlitz WebContainers, because WebContainers needs a commercial license.

---

## 1. Architecture

```
┌──────────────────────── Builder app (origin A: localhost:5180) ────────────────────────┐
│                                                                                        │
│  Chat panel ──prompt──▶ POST /api/sessions/{id}/turns  (SSE stream back)               │
│      ▲                        │                                                        │
│      │                 file.start / file.delta / file.end / done                       │
│      │                        ▼                                                        │
│      │                 In-memory VFS (Map<path, string>)                               │
│      │                        │ debounce 150ms on file.end                             │
│      │                        ▼                                                        │
│      │      ┌──────────── validator.worker ────────────┐   ┌── compile.worker ──┐      │
│      │      │ 1. import allowlist (es-module-lexer)    │   │ esbuild-wasm       │      │
│      │      │ 2. DS lint rules (AST, fast)             │──▶│ VFS plugin         │      │
│      │      │ 3. tsc via @typescript/vfs (lazy)        │   │ externals: react,  │      │
│      │      └──────────────────────────────────────────┘   │ react-dom, @ds/*   │      │
│      │                        │ errors                     └─────────┬──────────┘      │
│      │                        ▼                                      │ ESM string      │
│      └──── auto-fix turn (max 2) ◀── diagnostics                     ▼                 │
│                                                       postMessage({type:'load', code}) │
└───────────────────────────────────────────────────────────────────────┬────────────────┘
                                                                        ▼
┌────────────── Preview page (origin B: localhost:5181, static) ──────────────┐
│ <script type="importmap"> react → CDN, react-dom → CDN, @ds/ui → CDN        │
│ Blob URL → import() → render <App/> inside <MockShell/>                      │
│ window.onerror / unhandledrejection / React error boundary ──▶ postMessage   │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Piece | Runs on | Cost |
|---|---|---|
| Code generation | Node server `/api/*` → OpenAI / Azure OpenAI | LLM tokens |
| Compile and validate | Browser web workers | None |
| Live preview | Browser iframe, separate origin | None |
| DS + React bundles | Static hosting / CDN | Negligible |
| History | Git branch via GitHub API (phase 4) | None |
| Shareable preview | Existing branch deploy, on click (phase 4) | As today |

---

## 2. Folder layout

```
ui-builder/
  PLAN.md
  package.json                # npm workspaces: ds, app, preview, server
  ds/                         # stub design system (stands in for the real one)
    src/                      #   Button, Card, Input, Stack, Text, Badge, Modal, Table, MockShell
    scripts/build.mjs         #   esbuild → dist/{version}/index.js (react external) + index.css
    scripts/manifest.mjs      #   reads .d.ts + JSDoc → manifest.json for the LLM prompt
    lint-rules.json           #   DS lint rules consumed by validator worker
  app/                        # builder SPA (Vite + React)
    src/chat/                 #   chat panel, SSE client
    src/vfs/                  #   in-memory file system + change events
    src/workers/compile.worker.ts
    src/workers/validate.worker.ts
    src/preview/bridge.ts     #   postMessage protocol to iframe
  preview/                    # static preview page (origin B)
    index.html                #   import map + loader
    runtime.js                #   load bundle, mount, error reporting
  server/
    src/index.ts              # Hono (or Express) server: POST /api/sessions/:id/turns
    src/llm.ts                # OpenAI / AzureOpenAI client factory
    src/protocol.ts           # incremental <file> block parser
    prompts/generate.md
  cdn/                        # local stand-in for the CDN (versioned, long-cache headers)
```

---

## 3. Component specs

### 3.1 Design system release job (`ds/`)

- `build.mjs`: run esbuild with `format: 'esm'`, `external: ['react', 'react-dom', 'react/jsx-runtime']`, `jsx: 'automatic'`. Outputs:
  - `cdn/ds/{version}/index.js`
  - `cdn/ds/{version}/index.css`
  - `cdn/ds/{version}/types/index.d.ts`, from `tsc --emitDeclarationOnly` bundled into one file.
- `manifest.mjs` → `cdn/ds/{version}/manifest.json`: for each component, its name, a one-line description, its props with types and enum values, and one usage example. This goes into the system prompt, so keep it under about 3k tokens.
- `cdn/ds/latest.json` → `{ "version": "0.1.0" }`. The builder pins the version at session start, so it doesn't change mid-session.
- **Real DS later:** the same script runs as a step in the DS repo's CI and uploads to the SSO-protected CDN path. Only `DS_BASE_URL` changes in the builder.

### 3.2 Generation endpoint (`server/`)

`POST /api/sessions/{id}/turns` with body `{ message, files?: Record<path,string>, diagnostics?: Diagnostic[] }`. Returns `text/event-stream`.

The LLM is asked to output files in a fenced block protocol, which is easier to stream than JSON:

```
<file path="src/App.tsx">
...code...
</file>
<file path="src/components/PricingTable.tsx">
...
</file>
<summary>One-line description of the change</summary>
```

`protocol.ts` parses the token stream incrementally and emits these SSE events:

| event | data |
|---|---|
| `file.start` | `{ path }` |
| `file.delta` | `{ path, text }` |
| `file.end` | `{ path }` |
| `file.delete` | `{ path }` (from `<delete path=.../>`) |
| `message` | `{ text }` (summary / prose outside blocks) |
| `done` | `{ turnId, usage }` |
| `error` | `{ message }` |

Prompt contents: the system rules, the DS manifest, the allowlist, the current files (all of them, or a summary once over budget), the last N chat turns, and any diagnostics from the previous attempt.

Session state is an in-memory map keyed by session id. Single session is fine for v1.

LLM client (`llm.ts`):

```ts
import OpenAI, { AzureOpenAI } from "openai";
export const client = process.env.AZURE_OPENAI_ENDPOINT
  ? new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// client.chat.completions.create({ model, messages, stream: true })
```

Environment variables: `OPENAI_API_KEY` and `OPENAI_MODEL`, or `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_VERSION` and `AZURE_OPENAI_DEPLOYMENT`. The key stays on the server and never reaches the browser.

### 3.3 VFS (`app/src/vfs`)

- `Map<string, string>` plus a version counter. `file.delta` appends to the file. `file.end` marks it complete.
- A build triggers only when **all open files are closed**, debounced 150ms. A half-streamed file is never compiled.
- An optional live view can show partial text in a code panel. It never feeds the compiler.

### 3.4 Compile worker (`compile.worker.ts`)

- Lazy `esbuild.initialize({ wasmURL: '/cdn/esbuild/0.x/esbuild.wasm' })` once per worker.
- `esbuild.build` with `bundle: true`, `format: 'esm'`, `jsx: 'automatic'`, `write: false`, `entryPoints: ['src/main.tsx']` (a fixed entry the builder owns, which imports `src/App.tsx`).
- Plugins:
  - `vfs`: resolves relative paths and loads from the VFS snapshot sent in the message.
  - `externals`: marks `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime` and `@ds/ui` as external. Everything else fails the allowlist.
  - `css`: imports of `.css` files from the VFS are inlined as a `<style>` injector.
  - Later, if the MFE template needs them: `svg` (as a React component or URL), `env` (`import.meta.env.*` → define), and CSS modules.
- Returns `{ ok, code, warnings }` or `{ ok:false, errors: Diagnostic[] }`.

### 3.5 Validator worker (`validate.worker.ts`)

Runs in three tiers. The cheap checks run first, and the build stops at the first failing tier:

1. **Import allowlist.** Use `es-module-lexer` on every file. Bare specifiers must be in `['react','react-dom','react-dom/client','@ds/ui']`. Relative imports must resolve inside the VFS.
2. **DS lint.** Rules from `ds/lint-rules.json`, run with a small Babel/Acorn-JSX walk:
   - no raw `<button>`, `<input>` or `<table>` (use the DS component)
   - no inline `style` with colour literals (use tokens)
   - no `fetch`, `localStorage` or `eval` in generated code
   - the `variant` prop must be one of the enum values from the manifest
3. **Type-check.** Uses `@typescript/vfs` and `typescript`, **loaded lazily** on the first build after the preview is up, so it doesn't block first paint. It loads the DS `.d.ts` and the React types from the CDN and reports only errors in user files.

Diagnostic shape: `{ file, line, col, code, message, tier }`.

### 3.6 Preview page (`preview/`)

- Served from **origin B**. The iframe uses `sandbox="allow-scripts"` with no `allow-same-origin`, so generated code can't read builder cookies or storage.
- Import map (one place, so React resolves to exactly one URL):
  ```html
  <script type="importmap">{"imports":{
    "react": "/cdn/react/18.3.1/react.mjs",
    "react/jsx-runtime": "/cdn/react/18.3.1/jsx-runtime.mjs",
    "react-dom": "/cdn/react-dom/18.3.1/react-dom.mjs",
    "react-dom/client": "/cdn/react-dom/18.3.1/client.mjs",
    "@ds/ui": "/cdn/ds/0.1.0/index.js"
  }}</script>
  ```
  React ESM builds are produced once by a script in `cdn/`, using esbuild on the npm packages with the `react` import shared. Do **not** mix esm.sh and local builds, because that gives two copies of React.
- The import map can't change after the first module loads, so a DS version change reloads the iframe.
- Protocol:
  - parent → iframe: `{type:'load', code, cssUrls}`
  - iframe → parent: `{type:'ready'}`, `{type:'rendered'}`, `{type:'runtime-error', message, stack}`, `{type:'console', level, args}`
- Hot swap: unmount the old root, then `import(URL.createObjectURL(new Blob([code],{type:'text/javascript'})))`, then mount inside `<MockShell>` and an error boundary. Revoke the previous Blob URL.
- CSP on origin B: `connect-src 'none'` stops generated code from calling out.

### 3.7 Feedback loop

```
build → validate (tiers 1-3) → compile → render
          │ fail                  │ fail     │ runtime-error within 3s
          └──────────── diagnostics ─────────┘
                         │
              auto-fix turn (hidden user message: "Fix these errors: …")
              max 2 attempts, then show errors to user with a "Try fix" button
```

The last good bundle stays on screen while a fix is in progress. The preview never goes blank.

---

## 4. Phases and tasks

### Phase 0: Spike (½ day)
- [ ] Load esbuild-wasm in a worker, bundle a hardcoded two-file VFS with React external, and render it in an iframe through the import map.
- [ ] Confirm hooks work, with no duplicate-React warning, using a DS component that calls `useState`.

**Exit:** a counter app built from in-memory strings renders and updates.

### Phase 1: Stub DS and CDN (1 day)
- [ ] `ds/src`: about 8 components, tokens as CSS variables, and `MockShell` (top bar plus side nav).
- [ ] `build.mjs`, `manifest.mjs`, versioned `cdn/` output.
- [ ] React and react-dom ESM builds in `cdn/`.
- [ ] Static server for `cdn/` and `preview/` on origin B with `Cache-Control: public, max-age=31536000, immutable` on versioned paths.

**Exit:** `preview/index.html` renders `<MockShell><Button/></MockShell>` from the CDN.

### Phase 2: Core loop (2–3 days)
- [ ] `server/`: SSE endpoint, OpenAI/Azure client, prompt assembly, and the incremental `<file>` parser, with unit tests on chunk boundaries.
- [ ] `app/`: chat panel, SSE client, VFS, compile worker, and the preview bridge.
- [ ] Validator tier 1 (allowlist) and tier 2 (DS lint).
- [ ] Runtime-error capture and the auto-fix loop (max 2).

**Exit:** "Build a pricing page with three tiers" streams files, the preview appears without a deploy, and a forced bad import is auto-fixed.

### Phase 3: Type-check and polish (1–2 days)
- [ ] Validator tier 3: lazy `@typescript/vfs`, with DS `.d.ts` from the CDN.
- [ ] Code panel (read-only, shows streaming text), file tree, and an error drawer.
- [ ] Measure first-load cost and confirm the TS worker is not on the critical path.

**Exit:** a wrong prop type is caught before render and fixed by the model.

### Phase 4: History and share (1–2 days)
- [ ] After each successful turn, the server commits the VFS to a branch `builder/{sessionId}` via the GitHub contents/trees API (one commit per turn, message = turn summary).
- [ ] "Restore to turn N" loads that commit into the VFS.
- [ ] "Share preview" triggers the existing branch deploy (webpack/MFE build) on click only.

### Phase 5: Swap in the real DS
- [ ] Add the release step to the real DS repo's CI and publish behind SSO.
- [ ] Point `DS_BASE_URL` and the allowlist name at it.
- [ ] Port its lint rules into `lint-rules.json`.
- [ ] Add esbuild plugins for whatever the MFE template relies on (CSS modules, SVG, env).

---

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Duplicate React breaks hooks | React is external everywhere and mapped once in the import map. Phase 0 checks for this explicitly. |
| esbuild ≠ production webpack | Preview is for fast iteration only. "Share preview" runs the real build. Add plugins for the template's needs as they come up. |
| Heavy first load (esbuild-wasm ~10MB, TS ~3–5MB) | Immutable cache headers, TS loaded lazily, esbuild initialised while the user types the first prompt. |
| LLM streams a half-written file | Compile only when every `<file>` block is closed. |
| Generated code is hostile or buggy | Sandboxed iframe on another origin, CSP `connect-src 'none'`, import allowlist, lint bans `fetch`/`eval`. |
| Auto-fix loops forever | Hard cap of 2 attempts per turn, then hand control back to the user. |
| Prompt grows with file count | Send full files only for those touched in the last 2 turns, and signatures for the rest. |
| Private DS on CDN behind SSO | The preview origin must share the SSO cookie domain, or the CDN must accept a short-lived signed URL issued by the builder server. Decide this in phase 5. |

---

## 6. Open questions

1. **MFE template specifics.** Which of CSS modules, SVG imports and `process.env` does it use? This decides the phase 5 plugins.
2. **SSO for the CDN.** Is the preview iframe on a subdomain that receives the SSO cookie, or do we need signed URLs?
3. **Model.** OpenAI or Azure, and which model or deployment should be the default? Code quality varies a lot between them.
4. **Branch history.** Which repo and branch naming should phase 4 commit to, and does the existing branch deploy pick up any branch automatically?
