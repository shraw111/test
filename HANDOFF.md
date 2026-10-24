# Handoff: UI Builder

For an AI (or person) continuing this project. Read this first, then `README.md` (how it works) and `PLAN.md` (original phased plan).

Everything below was true on branch `claude/ui-builder-plan`. If you can run the tests (see "Verify the baseline") they are the source of truth, not this file.

## 1. What this project is

A **prompt-to-UI builder**. A user describes a page, an LLM writes React code that uses a company design system, and the **user's browser** compiles and previews it. The point is that running it costs only LLM tokens and static file hosting: there is no per-user build server.

| Piece | Runs on |
|---|---|
| Code generation | A server calling an LLM (not built yet) |
| Compile (esbuild-wasm) and type-check (TypeScript) | Web workers in the user's browser |
| Preview | Sandboxed iframe on a separate origin |
| React, design system | Static files, mapped by an import map |
| AEM content access | Small Node server holding the credentials |

The decision to use esbuild-wasm rather than StackBlitz WebContainers was made deliberately: WebContainers needs a commercial license.

## 2. Decisions the user already made. Do not reopen them

- **The chatbot comes last.** Rendering came first, then type-checking, then AEM. The chatbot is the main remaining feature.
- **Standalone project.** It has nothing to do with VP Maker (another repo of the same user). Do not touch or reference it.
- **LLM provider: OpenAI or Azure OpenAI**, using the official `openai` npm package. Azure is used when `AZURE_OPENAI_*` variables are present. The default model or deployment was **not decided**; ask.
- **Design system:** a stub (`ds/`) stands in for the real one until the user supplies it.
- **AEM:** must support **both AEM as a Cloud Service and AEM 6.5**. Two flows: (A) the user pastes a link and we fetch the fragment; (B) we create a new content fragment.
  - New fragments go in **one fixed folder** (`AEM_TARGET_FOLDER`).
  - A **shared service account** does the writing.
  - New fragments are saved **unpublished** (Author only).
  - Saving is **always behind an explicit confirmation**, and never overwrites.
- **Security is not a priority** where it doesn't affect function ("if it doesn't matter functionally I don't care about security"). Cheap hygiene was kept anyway, such as credentials never entering the browser. See "Known gaps" before you ship anything.
- **The user has no real AEM instance.** Everything AEM-related was tested only against a fake. See section 6.

## 3. Where things are

Repo: `github.com/shraw111/test` (private). The repo is named `test` and has not been renamed. Work is on branch `claude/ui-builder-plan`; **it has not been merged to `main` and no PR exists**. Do not open a PR unless the user asks.

```
src/engine/            compile.ts, compile.worker.ts, compiler.ts
                       typecheck.ts, typecheck.worker.ts, type-checker-client.ts
                       preview-bridge.ts, index.ts (PreviewEngine), types.ts, paths.ts
src/content/           store.ts (ContentStore), typegen.ts, samples.ts, aem-api.ts, types.ts
src/App.tsx            the editor + preview + panels
src/Editor.tsx         CodeMirror with inline diagnostics
src/ContentPanel.tsx   AEM link, drafts, save to AEM
src/examples.ts        sample projects in the dropdown
content/src/index.ts   the `@aem/content` module generated code imports
ds/src/                stub design system (`@ds/ui`)
preview/               index.html template + runtime.js (runs inside the iframe)
server/                aem.mjs (AEM client), index.mjs (HTTP API)
scripts/               build-cdn.mjs, build-types.mjs, serve-preview.mjs
cdn.config.json        THE import map. Also defines which packages generated code may import
tests/unit/            vitest: compile, typecheck, content, aem
tests/e2e/             playwright: render.spec.ts, content.spec.ts
tests/helpers/         fake-aem.mjs
```

### How the pieces fit

```
editor files ─▶ PreviewEngine.render(files)
   ├─ compile.worker (esbuild-wasm): bundles in memory. react, react-dom, @ds/ui, @aem/content stay external
   ├─ typecheck.worker (lazy): checks user files against React + DS + generated content types
   └─ PreviewBridge.load ─postMessage─▶ preview iframe (separate origin, sandbox without allow-same-origin)
                                         import map resolves react etc. to ONE url
                                         runtime.js: import(blob:) → render in an error boundary
        errors, console, content requests ◀─postMessage─┘
```

`PreviewEngine` is the surface the chatbot must drive. `new PreviewEngine(iframe, { typeCheck, content })`, then `render(files)`. Events come from `subscribe`: `compiling`, `compiled`, `typechecked`, `rendered`, `runtime-error`, `console`.

## 4. Invariants. Breaking any of these breaks the product

1. **One React instance.** Every bundle keeps `react` external; the import map in `cdn.config.json` maps it once. Duplicate React breaks hooks. `scripts/build-cdn.mjs` builds React/ReactDOM as ESM sharing one React. Never load React from a second source.
2. **Preview isolation.** The iframe is sandboxed *without* `allow-same-origin`, and the preview page's CSP has `connect-src 'none'`. Generated code must never get network access or the app's cookies. Content reaches it only through `@aem/content` → postMessage to the app.
3. **`ALLOWED_IMPORTS` is derived from `cdn.config.json`.** Adding a package for generated code means adding it to the import map, building it in `build-cdn.mjs`, and (for types) providing declarations to the type-checker.
4. **Only the newest build may render.** `PreviewEngine` ignores stale compiles, and `preview/runtime.js` tracks `newestRequested` so an older import that finishes late never overwrites a newer build or reports an error. There are regression tests (`older build…`, `superseded build…`). Do not remove that logic.
5. **A failed build keeps the last good one on screen.**
6. **Never overwrite existing AEM content.** `createFragment` pre-checks existence, and the UI confirms. Writes are confined to `AEM_TARGET_FOLDER`.
7. **The API server holds AEM credentials; the browser and iframe never do.**

## 5. Verify the baseline first

Needs Node 22. Playwright is pinned to `1.63.0` to match the preinstalled Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); do **not** run `playwright install`. Ports 5180, 5181, 5182 and 5190 must be free.

```bash
npm install
npx tsc --noEmit        # must be clean
npm test                # builds public/types.json, then vitest: 47 tests
npm run test:e2e        # playwright: 23 tests (starts the dev server and a fake AEM itself)
npm run dev             # app :5180, preview origin :5181, API :5182
```

Expected at handoff: all green, and the e2e suite was run four times in a row green. If anything fails before you change anything, investigate that first.

## 6. What is NOT verified. Treat as assumptions

**AEM was never run against a real instance.** The server (`server/aem.mjs`) follows Adobe's documented Assets HTTP API and is tested against `tests/helpers/fake-aem.mjs`, which I wrote from my understanding of the API. Specific guesses:

- Reading: `GET {base}/api/assets/<path under /content/dam>.json` returns Siren JSON with `properties["cq:model"]` and `properties.elements.<field>.value`.
- Creating: `POST {base}/api/assets/<folder>/<name>` with body `{"properties":{"cq:model","title","description","elements":{field:{value}}}}` returns 2xx (409 if it exists).
- **The target folder must already exist.** Nothing creates it. I do not know how a real AEM responds if it is missing.
- Auth: Cloud Service accepts `Authorization: Bearer <token>`; 6.5 accepts Basic auth. Real Cloud Service tokens expire (the code takes a static `AEM_TOKEN`, with no refresh).
- 6.5 needs a service pack that supports the API. Not checked.
- Field types are **inferred from values** in loaded fragments, not read from the model definition.

Other things never tested: browsers other than Chromium; a production deployment of any kind; CORS or SSO against a real CDN; large projects (many files) for compile/type-check performance.

## 7. The work, in priority order

### 7.1 The chatbot (main feature; nothing exists yet)

Goal: user types a prompt, files stream in, the preview updates, errors go back to the model automatically.

Build:
- **Server endpoint** `POST /api/sessions/:id/turns` returning Server-Sent Events. It calls the LLM via the `openai` SDK (`AzureOpenAI` if `AZURE_OPENAI_*` env vars exist, else `OpenAI`). Put it in `server/` next to `index.mjs`; reuse its handler/config pattern. The API key stays on the server.
- **Output protocol:** the model writes files as `<file path="App.tsx">…</file>`, plus `<delete path="…"/>` and a `<summary>…</summary>`. Write an **incremental parser** that handles tags split across stream chunks (unit-test chunk boundaries). SSE events: `file.start`, `file.delta`, `file.end`, `file.delete`, `message`, `done`, `error`.
- **Browser side:** apply events to a files map; call `engine.render(files)` only when **every `<file>` block is closed** (never compile a half-written file).
- **Prompt assembly:** system rules; the **allowed imports** (`ALLOWED_IMPORTS`); a **design-system manifest** (see 7.2); the **AEM content types** (`generateContentTypes` output, and the list of loaded fragment paths); the current files; recent chat turns; any diagnostics from the last attempt.
- **Auto-fix loop:** use `typeCheck: "block"`. On compile errors, type errors or runtime errors, send the diagnostics back to the model as a hidden turn. **Max 2 automatic attempts per user turn**, then show the errors and let the user decide. Keep the last good preview on screen throughout.
- Single session is fine for v1 (in-memory).

Acceptance: "Build a pricing page with three tiers using the design system" streams files, renders, and a deliberately invalid prop in the model's first output is fixed automatically without the user doing anything. Add an e2e test using a **stubbed LLM** (a local fake that streams a scripted response); do not call a real LLM in CI.

Open question to ask the user: default model / Azure deployment.

### 7.2 Design system manifest and lint rules

- `ds/scripts/manifest.mjs` (not written): produce a compact manifest for the prompt: component names, one-line descriptions, props with types and enum values, one usage example each. Target under ~3k tokens. It can be derived from the same declaration emit `scripts/build-types.mjs` already does.
- **Lint tier** (not built): rules such as no raw `<button>`/`<input>`/`<table>` (use the DS component), no inline colour literals, no `fetch`/`localStorage`/`eval`. Run in the validator worker before compile; report as diagnostics with `source: "lint"`.

### 7.3 Make AEM real

Needs a real AEM instance, which the user does not have. Until one exists, keep the fake in sync with any corrections.

1. Write `npm run verify:aem`: against the configured instance, read a known fragment, create one in the target folder, read it back, and print any difference from what the code expects. Anyone with AEM access can run it and paste the output.
2. Fix `server/aem.mjs` and the fake to match reality (response shape, create call, missing-folder behaviour, token expiry).
3. Read model definitions instead of inferring types from values.
4. Add a GraphQL persisted-query read path (`/graphql/execute.json/<config>/<query>`), which most Cloud Service projects use and which is CDN-cacheable. Fragment references are not handled.
5. Run the e2e suite against both flavors (the config currently hard-codes the Cloud one; unit tests already cover both).

### 7.4 Production deployment (nothing exists)

- `npm run build` builds only the app. The **API server is started by a Vite dev plugin** (`vite.config.ts`) and the dev proxy sends `/api` to port 5182. There is no production story for `server/`.
- The preview must be hosted on a **different origin** from the app (static host or CDN). It needs `Access-Control-Allow-Origin: *` (the sandboxed iframe's origin is `null`) and long cache headers on `/cdn/*`. Build the app with `VITE_PREVIEW_URL=…`.
- If the real design system sits behind company SSO, decide how the preview (an opaque-origin iframe) authenticates to it: a subdomain that receives the cookie, or short-lived signed URLs from the builder server. Unanswered.
- Serve `esbuild.wasm` (14MB raw, 3.8MB gzipped) and the TypeScript worker (3.6MB) with long cache headers.

### 7.5 Swap in the real design system

Its CI needs a release step that outputs an ESM bundle with React external, plus its CSS and `.d.ts` files, to a versioned path. Then: update `cdn.config.json`, point `scripts/build-types.mjs` at the published declarations instead of emitting from `ds/src`, and port its lint rules. Ask the user for the repo and CI.

### 7.6 Build features of the real MFE template

esbuild is not the production webpack build. If the template relies on CSS modules, SVG imports or environment variables, each needs an esbuild plugin in `src/engine/compile.ts`. Ask the user which. CSS imports from plain `.css` files already work.

### 7.7 History and sharing (Phase 4 in PLAN.md)

One git commit per successful turn to a branch, "restore to turn N", and a "Share preview" button that triggers the existing branch deploy (real build) on click. Needs: which repo, branch naming, and whether the deploy picks up any branch. Unanswered.

### 7.8 Smaller items

- File tree and a read-only streaming code view (listed in PLAN.md phase 3).
- State is in memory: reloading the page loses files and the content store.
- Only Chromium is tested.
- `npm audit` reports vulnerabilities in dev dependencies; not triaged.

## 8. Known gaps (decided or left open)

- **The API server is unauthenticated** and anyone who can reach port 5182 can create fragments with the service account. That matches the user's "don't care about security" instruction for development, but **it must be fixed before any shared deployment**.
- The server fetches only `AEM_BASE_URL`; the host in a pasted link is ignored, so there is no SSRF through links.
- The leftover branch `claude/ui-builder-plan` on the user's **other** repo `shraw111/vpmaker` should be deleted by the user. It was pushed by mistake early on and the environment could not delete it. It is unrelated to this project.

## 9. Working notes and gotchas

- **Environment:** this was developed in a sandboxed cloud container. GitHub repo creation was denied; the user created `shraw111/test` themselves. The git proxy cannot delete remote branches.
- **Stop-hook warning about "unpushed commits":** a false alarm caused by the shallow clone not having a local `origin/<branch>` ref. Fix with `git fetch origin +refs/heads/<branch>:refs/remotes/origin/<branch>`.
- **`public/types.json` is generated and git-ignored** (4.5MB: React types, DS declarations, TypeScript lib files). `npm test` and `npm run dev` build it. If type-check tests fail with a missing file, run `npm run build:types`.
- **`preview/dist/` is generated** by `npm run build:cdn`; `npm run dev` runs it. After editing `preview/runtime.js` or `content/src/index.ts` you must rebuild it.
- **Status text:** the app's "Rendered" status means the compile finished, not that the iframe has painted. Tests that need the painted result should wait on the preview content, not the status pill. This caused real flakiness.
- **Playwright's default expect timeout is 15s** (`playwright.config.ts`) because several pages each run a TypeScript worker in parallel.
- **When editing the editor's diagnostics:** `@codemirror/lint`'s `linter()` source does not re-run when only external data changes; diagnostics are pushed with `setDiagnostics` instead. Don't "simplify" this back.
- **`@aem/content` types are dynamic:** the declarations are generated from whatever fragments are loaded and passed to the type-checker as ambient files. Without them the import fails to type-check, which is why `PreviewEngine` always passes them.
- When you fix a bug, add a test that **fails without the fix**. Several earlier tests turned out to prove nothing until they were checked that way.
