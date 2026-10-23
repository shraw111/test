// Static server for the preview origin (preview/dist). In production this is
// any static host / CDN; the only requirements are CORS (the sandboxed iframe
// has an opaque origin) and long cache headers on versioned /cdn paths.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../preview/dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};

export function startPreviewServer(port = Number(process.env.PREVIEW_PORT ?? 5181)) {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = normalize(join(dir, pathname === "/" ? "index.html" : pathname));
    if (!file.startsWith(dir)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": pathname.startsWith("/cdn/") ? "public, max-age=31536000, immutable" : "no-cache",
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "Access-Control-Allow-Origin": "*" }).end("Not found");
    }
  });
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolveListen(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startPreviewServer();
  console.log(`preview origin on http://localhost:${server.address().port}`);
}
