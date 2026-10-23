import type * as esbuild from "esbuild-wasm";
import cdnConfig from "../../cdn.config.json";
import { dirname, normalize, resolveFile } from "./paths";
import type { CompileResult, Diagnostic, Files } from "./types";

/** Bare imports generated code may use. They stay external and resolve through the preview's import map. */
export const ALLOWED_IMPORTS = Object.keys(cdnConfig.imports);

export const ENTRY_CANDIDATES = ["App.tsx", "App.jsx", "App.ts", "App.js", "index.tsx", "index.jsx"];

const LOADERS: Record<string, esbuild.Loader> = {
  ".tsx": "tsx",
  ".ts": "ts",
  ".jsx": "jsx",
  ".js": "jsx",
  ".css": "css",
  ".json": "json",
};

function loaderFor(path: string): esbuild.Loader {
  const ext = path.slice(path.lastIndexOf("."));
  return LOADERS[ext] ?? "text";
}

function vfsPlugin(files: Files): esbuild.Plugin {
  return {
    name: "vfs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return { path: normalize(args.path), namespace: "vfs" };

        const spec = args.path;
        if (spec.startsWith(".") || spec.startsWith("/")) {
          const absolute = normalize(spec.startsWith("/") ? spec : `${dirname(args.importer)}/${spec}`);
          const resolved = resolveFile(files, absolute);
          if (resolved) return { path: resolved, namespace: "vfs" };
          return { errors: [{ text: `Cannot find file "${spec}"` }] };
        }

        if (ALLOWED_IMPORTS.includes(spec)) return { path: spec, external: true };
        return {
          errors: [
            {
              text: `Package "${spec}" is not available in the preview. Allowed packages: ${ALLOWED_IMPORTS.join(", ")}`,
            },
          ],
        };
      });

      build.onLoad({ filter: /.*/, namespace: "vfs" }, (args) => ({
        contents: files[args.path.slice(1)],
        loader: loaderFor(args.path),
      }));
    },
  };
}

function toDiagnostic(message: esbuild.Message): Diagnostic {
  return {
    file: message.location?.file.replace(/^vfs:\//, "").replace(/^\//, ""),
    line: message.location?.line,
    column: message.location?.column,
    message: message.text,
  };
}

export function findEntry(files: Files): string | undefined {
  return ENTRY_CANDIDATES.find((name) => name in files);
}

/** Bundles the in-memory project into one ESM module (plus CSS) with React and the DS left external. */
export async function compile(api: typeof esbuild, files: Files): Promise<CompileResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  const entry = findEntry(files);
  if (!entry) {
    return {
      ok: false,
      errors: [{ message: `No entry file. Add one of: ${ENTRY_CANDIDATES.join(", ")}` }],
      warnings: [],
      ms: elapsed(),
    };
  }

  try {
    const result = await api.build({
      entryPoints: [`/${entry}`],
      bundle: true,
      write: false,
      format: "esm",
      target: "es2020",
      jsx: "automatic",
      outdir: "/out",
      sourcemap: "inline",
      logLevel: "silent",
      plugins: [vfsPlugin(files)],
    });
    const js = result.outputFiles.find((f) => f.path.endsWith(".js"))?.text ?? "";
    const css = result.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";
    return { ok: true, js, css, warnings: result.warnings.map(toDiagnostic), ms: elapsed() };
  } catch (error) {
    const failure = error as esbuild.BuildFailure;
    if (!Array.isArray(failure.errors)) {
      return { ok: false, errors: [{ message: String(error) }], warnings: [], ms: elapsed() };
    }
    return {
      ok: false,
      errors: failure.errors.map(toDiagnostic),
      warnings: (failure.warnings ?? []).map(toDiagnostic),
      ms: elapsed(),
    };
  }
}
