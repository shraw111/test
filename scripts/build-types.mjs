// Packages every .d.ts the in-browser type-checker needs into
// public/types.json ({ "/virtual/path.d.ts": "contents" }), fetched lazily by
// the type-check worker. Lib files are included so no CDN is involved.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const files = {};
const read = (p) => readFileSync(p, "utf8");

// 1. TypeScript lib files (es2020 + dom). Only lib.*.d.ts directly in lib/.
const libDir = dirname(require.resolve("typescript/lib/lib.d.ts"));
for (const name of readdirSync(libDir)) {
  if (/^lib\..*\.d\.ts$/.test(name)) files[`/${name}`] = read(join(libDir, name));
}

// 2. Third-party types, mounted under /node_modules so bundler resolution finds them.
function addPackage(pkgName, include) {
  const dir = dirname(require.resolve(`${pkgName}/package.json`));
  const walk = (sub) => {
    for (const entry of readdirSync(join(dir, sub), { withFileTypes: true })) {
      const rel = join(sub, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (include(rel)) files[`/node_modules/${pkgName}/${rel}`] = read(join(dir, rel));
    }
  };
  walk("");
  files[`/node_modules/${pkgName}/package.json`] = read(join(dir, "package.json"));
}
const dts = (rel) => rel.endsWith(".d.ts") && !/(canary|experimental)\.d\.ts$/.test(rel);
addPackage("@types/react", dts);
addPackage("@types/react-dom", dts);
addPackage("@types/prop-types", dts);
addPackage("csstype", (rel) => rel === "index.d.ts");

// 3. The design system's own declarations, emitted from its source.
const dsEntry = join(root, "ds/src/index.tsx");
let dsDts = "";
const program = ts.createProgram([dsEntry], {
  declaration: true,
  emitDeclarationOnly: true,
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  types: [],
});
const emit = program.emit(undefined, (name, text) => {
  if (name.endsWith("index.d.ts")) dsDts = text;
});
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emit.diagnostics];
if (diagnostics.length || !dsDts) {
  throw new Error("Design system failed to type-check:\n" + ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (f) => f, getCurrentDirectory: () => root, getNewLine: () => "\n",
  }));
}
files["/node_modules/@ds/ui/index.d.ts"] = dsDts;
files["/node_modules/@ds/ui/package.json"] = JSON.stringify({ name: "@ds/ui", types: "index.d.ts" });

// 4. Ambient declarations for non-TS imports the compile step supports.
files["/ambient.d.ts"] = `declare module "*.css";\n`;

mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public/types.json"), JSON.stringify(files));
const kb = Math.round(Buffer.byteLength(JSON.stringify(files)) / 1024);
console.log(`public/types.json: ${Object.keys(files).length} files, ${kb} KB`);
