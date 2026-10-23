// Minimal POSIX path helpers for the in-memory file system. Paths are
// absolute inside the VFS ("/App.tsx"); project files are stored without
// the leading slash.

export function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return "/" + parts.join("/");
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".css", ".json"];

/** Resolves an import the way a bundler would: exact file, then extensions, then index files. */
export function resolveFile(files: Record<string, string>, absolute: string): string | undefined {
  const key = (p: string) => p.slice(1);
  const candidates = [
    absolute,
    ...EXTENSIONS.map((ext) => absolute + ext),
    ...EXTENSIONS.map((ext) => `${absolute}/index${ext}`),
  ];
  return candidates.find((c) => key(c) in files);
}
