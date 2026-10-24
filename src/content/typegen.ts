import type { Fragment } from "./types";

const IDENT = /^[A-Za-z_$][\w$]*$/;
const key = (name: string) => (IDENT.test(name) ? name : JSON.stringify(name));

function typeOf(value: unknown, depth = 0): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return typeof value;
    case "object": {
      if (Array.isArray(value)) {
        const items = [...new Set(value.map((v) => typeOf(v, depth + 1)))];
        return items.length === 0 ? "unknown[]" : `(${items.join(" | ")})[]`;
      }
      if (depth >= 3) return "Record<string, unknown>";
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return "Record<string, unknown>";
      return `{ ${entries.map(([k, v]) => `${key(k)}: ${typeOf(v, depth + 1)}`).join("; ")} }`;
    }
    default:
      return "unknown";
  }
}

/**
 * Declarations for @aem/content, derived from the fragments currently loaded.
 * One interface per model; a field missing from some fragments is optional;
 * a field whose type differs between fragments becomes a union.
 */
export function generateContentTypes(fragments: Fragment[]): string {
  const byModel = new Map<string, Fragment[]>();
  for (const f of fragments) byModel.set(f.model, [...(byModel.get(f.model) ?? []), f]);

  const interfaces: string[] = [];
  for (const [model, group] of byModel) {
    const names = [...new Set(group.flatMap((f) => Object.keys(f.fields)))];
    const lines = names.map((name) => {
      const types = [...new Set(group.filter((f) => name in f.fields).map((f) => typeOf(f.fields[name])))];
      const optional = group.some((f) => !(name in f.fields)) ? "?" : "";
      return `  ${key(name)}${optional}: ${types.join(" | ")};`;
    });
    interfaces.push(`export interface ${model} {\n  _path: string;\n  _title: string;\n${lines.join("\n")}\n}`);
  }

  const fragmentMap = fragments.map((f) => `  ${JSON.stringify(f.path)}: ${f.model};`).join("\n");
  const modelMap = [...byModel.keys()].map((m) => `  ${m}: ${m};`).join("\n");

  return `${interfaces.join("\n\n")}

export interface FragmentMap {
${fragmentMap}
}
export interface ModelMap {
${modelMap}
}
export interface FragmentState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
}
/** One fragment by path. Only paths that exist in the loaded content are accepted. */
export declare function useFragment<P extends keyof FragmentMap>(path: P): FragmentState<FragmentMap[P]>;
/** Every fragment of a model. */
export declare function useFragmentList<M extends keyof ModelMap>(model: M): FragmentState<ModelMap[M][]>;
`;
}

/** Files to add to the type-checker's virtual file system, keyed by absolute path. */
export function contentTypeFiles(fragments: Fragment[]): Record<string, string> {
  return {
    "/node_modules/@aem/content/package.json": JSON.stringify({ name: "@aem/content", types: "index.d.ts" }),
    "/node_modules/@aem/content/index.d.ts": generateContentTypes(fragments),
  };
}

/** A blank value of the same shape, for starting a new fragment from an existing one. */
export function blankLike(value: unknown): unknown {
  if (typeof value === "string") return "";
  if (typeof value === "number") return 0;
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return [];
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, blankLike(v)]));
  }
  return null;
}
