// A fake AEM implementing the slice of the Assets HTTP API the builder uses,
// with the real instances' difference in authentication.
import { createServer } from "node:http";

export function startFakeAem({ flavor = "cloud", port = 0, token = "test-token", user = "admin", password = "secret" } = {}) {
  const store = new Map();
  const log = [];
  const authorized = (header) =>
    flavor === "cloud"
      ? header === `Bearer ${token}`
      : header === `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

  const server = createServer(async (req, res) => {
    log.push(`${req.method} ${req.url}`);
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(body));
    };
    if (!authorized(req.headers.authorization)) {
      // 6.5 redirects unauthenticated browsers to a login page; Cloud Service answers 401.
      if (flavor === "65" && !req.headers.authorization) {
        res.writeHead(302, { Location: "/libs/granite/core/content/login.html" }).end();
        return;
      }
      return json(401, { error: "unauthorized" });
    }
    const m = /^\/api\/assets(\/.*?)(?:\.json)?$/.exec(new URL(req.url, "http://x").pathname);
    if (!m) return json(404, {});
    const path = `/content/dam${m[1]}`;

    if (req.method === "GET") {
      const properties = store.get(path);
      return properties ? json(200, { class: ["assets/asset"], properties }) : json(404, {});
    }
    if (req.method === "POST") {
      if (store.has(path)) return json(409, { error: "exists" });
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const { properties } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      store.set(path, { name: path.split("/").pop(), ...properties });
      return json(201, {});
    }
    return json(405, {});
  });

  return new Promise((resolve) =>
    server.listen(port, () =>
      resolve({
        server,
        store,
        log,
        url: `http://localhost:${server.address().port}`,
        seed(path, model, title, fields) {
          store.set(path, {
            name: path.split("/").pop(),
            title,
            "cq:model": model,
            elements: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { ":type": typeof v === "string" ? "string" : "json", value: v }])),
          });
        },
        close: () => new Promise((r) => server.close(r)),
      }),
    ),
  );
}

// Run standalone for e2e: node tests/helpers/fake-aem.mjs
import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const aem = await startFakeAem({ flavor: process.env.FAKE_AEM_FLAVOR ?? "cloud", port: Number(process.env.FAKE_AEM_PORT ?? 5190) });
  const model = "/conf/acme/settings/dam/cfm/models/hero-banner";
  aem.seed("/content/dam/acme/summer-sale", model, "Summer Sale", {
    headline: "Summer Sale from AEM",
    subhead: "Live content, not a sample",
    ctaLabel: "Shop now",
    featured: true,
    tags: ["sale", "summer"],
  });
  aem.seed("/content/dam/acme/photo", "/conf/acme/settings/dam/cfm/models/x", "Not a fragment", {});
  aem.store.get("/content/dam/acme/photo").elements = undefined;
  console.log(`fake AEM (${process.env.FAKE_AEM_FLAVOR ?? "cloud"}) on ${aem.url}`);
}
