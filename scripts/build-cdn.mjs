// Builds everything the preview iframe loads: React + ReactDOM as ESM, the
// design system bundle, and preview/dist/index.html with the import map.
//
// Every bundle keeps `react` external, so the import map resolves it to one
// URL and there is exactly one React instance (duplicate React breaks hooks).
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "preview/dist");
const config = JSON.parse(readFileSync(join(root, "cdn.config.json"), "utf8"));
const require = createRequire(join(root, "package.json"));

const reactVersion = require("react/package.json").version;
const reactDomVersion = require("react-dom/package.json").version;
for (const [spec, url] of Object.entries(config.imports)) {
  const expected = spec.startsWith("react-dom") ? reactDomVersion : spec.startsWith("react") ? reactVersion : null;
  if (expected && !url.includes(`/${expected}/`)) {
    throw new Error(`cdn.config.json maps ${spec} to ${url}, but node_modules has ${expected}`);
  }
}

const shared = ["react", "react/jsx-runtime", "react-dom"];

// CJS packages call require("react"). With react external, esbuild would emit a
// dynamic require that throws in the browser, so route those through an ESM
// re-export of the external module instead.
const externalReact = (externals) => ({
  name: "external-react",
  setup(build) {
    build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => {
      if (!externals.includes(args.path)) return undefined;
      if (args.kind === "require-call") return { path: args.path, namespace: "esm-shim" };
      return { path: args.path, external: true };
    });
    build.onLoad({ filter: /.*/, namespace: "esm-shim" }, (args) => ({
      contents: `export * from ${JSON.stringify(args.path)};`,
      loader: "js",
    }));
  },
});

// Turns a CJS package into an ESM module with real named exports.
function cjsEntry(spec) {
  const names = Object.keys(require(spec)).filter((n) => n !== "default" && /^[A-Za-z_$][\w$]*$/.test(n));
  return [
    `import M from ${JSON.stringify(spec)};`,
    "export default M;",
    ...names.map((n) => `export const ${n} = M.${n};`),
  ].join("\n");
}

async function buildCjs(spec, outfile, externals) {
  await esbuild.build({
    stdin: { contents: cjsEntry(spec), resolveDir: root, loader: "js" },
    bundle: true,
    format: "esm",
    target: "es2020",
    outfile: join(out, outfile),
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [externalReact(externals)],
    logLevel: "warning",
  });
}

process.env.NODE_ENV = "development";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const url = (spec) => config.imports[spec].replace(/^\//, "");
await buildCjs("react", url("react"), []);
await buildCjs("react/jsx-runtime", url("react/jsx-runtime"), ["react"]);
await buildCjs("react-dom", url("react-dom"), ["react"]);
await buildCjs("react-dom/client", url("react-dom/client"), shared);

await esbuild.build({
  entryPoints: [join(root, "ds/src/index.tsx")],
  bundle: true,
  format: "esm",
  target: "es2020",
  jsx: "automatic",
  external: shared,
  outfile: join(out, url("@ds/ui")),
  logLevel: "warning",
});
await esbuild.build({
  entryPoints: [join(root, "ds/src/styles.css")],
  bundle: true,
  outfile: join(out, config.styles[0].replace(/^\//, "")),
  logLevel: "warning",
});

// The import map must be inline, so CSP allows it by hash rather than 'unsafe-inline'.
const importMap = JSON.stringify({ imports: config.imports });
const hash = createHash("sha256").update(importMap).digest("base64");
const html = readFileSync(join(root, "preview/index.html"), "utf8")
  .replace("<!--IMPORTMAP-->", `<script type="importmap">${importMap}</script>`)
  .replace("<!--STYLES-->", config.styles.map((s) => `<link rel="stylesheet" href="${s}">`).join("\n    "))
  .replace("IMPORTMAP_HASH", `'sha256-${hash}'`);
writeFileSync(join(out, "index.html"), html);
cpSync(join(root, "preview/runtime.js"), join(out, "runtime.js"));

console.log(`preview/dist built (react ${reactVersion}, import map ${Object.keys(config.imports).length} entries)`);
