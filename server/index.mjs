// Small API the builder talks to. Holds the AEM credentials so the browser
// (and the sandboxed preview) never see them.
//   GET  /api/aem/config   -> { configured, flavor, host, targetFolder }
//   POST /api/aem/resolve  { link }                          -> { fragment }
//   POST /api/aem/create   { name, title, modelPath, fields } -> { path, url }
import { createServer } from "node:http";
import { AemClient, AemError, loadConfig, parseAemLink } from "./aem.mjs";

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new AemError("Request body is not valid JSON.", 400);
  }
}

export function createApiHandler(config, fetchImpl) {
  const client = config ? new AemClient(config, fetchImpl) : undefined;
  return async (req, res) => {
    const { pathname } = new URL(req.url, "http://x");
    try {
      if (req.method === "GET" && pathname === "/api/aem/config") {
        return send(res, 200, config
          ? { configured: true, flavor: config.flavor, host: new URL(config.baseUrl).host, targetFolder: config.targetFolder || null }
          : { configured: false });
      }
      if (!pathname.startsWith("/api/aem/")) return send(res, 404, { error: "Not found" });
      if (!client) throw new AemError("AEM is not configured. Set AEM_BASE_URL (see README).", 503);

      if (req.method === "POST" && pathname === "/api/aem/resolve") {
        const { link } = await readJson(req);
        const parsed = parseAemLink(link);
        if (!parsed) throw new AemError("That doesn't look like a link to a content fragment (no /content/dam/... path found).", 400);
        return send(res, 200, { fragment: await client.readFragment(parsed.path) });
      }
      if (req.method === "POST" && pathname === "/api/aem/create") {
        const body = await readJson(req);
        return send(res, 201, await client.createFragment(body));
      }
      return send(res, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof AemError) return send(res, error.status, { error: error.message });
      console.error(error);
      return send(res, 500, { error: "Internal error" });
    }
  };
}

export function startApiServer(port = Number(process.env.API_PORT ?? 5182), env = process.env) {
  const server = createServer(createApiHandler(loadConfig(env)));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}
