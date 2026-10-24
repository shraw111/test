// AEM access for both AEM as a Cloud Service and AEM 6.5. Both expose the
// Assets HTTP API under /api/assets (which maps to /content/dam), so one
// client covers both; only authentication differs:
//   cloud: Authorization: Bearer <token>   (IMS access token / service credential)
//   65:    Authorization: Basic <user:pass> (or a Bearer token if one is given)
//
// NOTE: written against Adobe's documented Assets HTTP API, tested against
// tests/helpers/fake-aem.mjs. Not yet verified against a live AEM.

const DAM = "/content/dam";

/** Pulls the DAM path out of whatever link a user pastes. Returns undefined if there isn't one. */
export function parseAemLink(input) {
  if (typeof input !== "string") return undefined;
  const text = input.trim();
  const match = /(\/content\/dam\/[^?#\s]+)/.exec(decodeURIComponent(text));
  if (!match) return undefined;
  let path = match[1]
    .replace(/\/jcr:content.*$/, "")
    .replace(/\.(json|html|model\.json)$/, "")
    .replace(/\/+$/, "");
  if (path === DAM || !path.startsWith(`${DAM}/`)) return undefined;
  let host;
  try {
    host = new URL(text).host;
  } catch {
    host = undefined; // a bare /content/dam/... path
  }
  return { path, host };
}

export function detectFlavor(baseUrl) {
  return /\.adobeaemcloud\.com$/i.test(new URL(baseUrl).hostname) ? "cloud" : "65";
}

/** Reads server-side config from the environment. Returns undefined when AEM is not configured. */
export function loadConfig(env = process.env) {
  if (!env.AEM_BASE_URL) return undefined;
  const baseUrl = env.AEM_BASE_URL.replace(/\/+$/, "");
  const targetFolder = (env.AEM_TARGET_FOLDER ?? "").replace(/\/+$/, "");
  if (targetFolder && !targetFolder.startsWith(`${DAM}/`)) {
    throw new Error(`AEM_TARGET_FOLDER must be inside ${DAM}/, got "${targetFolder}"`);
  }
  let authorization;
  if (env.AEM_TOKEN) authorization = `Bearer ${env.AEM_TOKEN}`;
  else if (env.AEM_USER) authorization = `Basic ${Buffer.from(`${env.AEM_USER}:${env.AEM_PASSWORD ?? ""}`).toString("base64")}`;
  return {
    baseUrl,
    flavor: env.AEM_FLAVOR === "cloud" || env.AEM_FLAVOR === "65" ? env.AEM_FLAVOR : detectFlavor(baseUrl),
    targetFolder,
    authorization,
  };
}

export class AemError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

/** Titlecases a model path's last segment: ".../models/hero-banner" -> "HeroBanner". */
export function modelName(modelPath) {
  return String(modelPath ?? "")
    .split("/")
    .pop()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

export class AemClient {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  #url(damPath) {
    return `${this.config.baseUrl}/api/assets${damPath.slice(DAM.length)}`;
  }

  async #request(url, init = {}) {
    const headers = { Accept: "application/json", ...init.headers };
    if (this.config.authorization) headers.Authorization = this.config.authorization;
    let res;
    try {
      res = await this.fetch(url, { ...init, headers, redirect: "manual" });
    } catch (error) {
      throw new AemError(`Cannot reach AEM at ${this.config.baseUrl}: ${error.message}`);
    }
    // A redirect on an API call is almost always a login page: credentials missing or wrong.
    if (res.status >= 300 && res.status < 400) throw new AemError("AEM redirected to a login page. Check AEM_TOKEN / AEM_USER.", 401);
    if (res.status === 401 || res.status === 403) {
      throw new AemError(`AEM rejected the credentials (${res.status}) for the ${this.config.flavor === "cloud" ? "Cloud Service" : "6.5"} instance.`, 401);
    }
    return res;
  }

  /** Reads one content fragment by its /content/dam path. */
  async readFragment(path) {
    if (!path.startsWith(`${DAM}/`)) throw new AemError(`"${path}" is not under ${DAM}`, 400);
    const res = await this.#request(`${this.#url(path)}.json`);
    if (res.status === 404) throw new AemError(`No asset at ${path}`, 404);
    if (!res.ok) throw new AemError(`AEM returned ${res.status} for ${path}`);
    return normalizeFragment(path, await res.json());
  }

  /** Creates a new fragment in the configured folder. Never overwrites. */
  async createFragment({ name, title, modelPath, fields }) {
    const { targetFolder } = this.config;
    if (!targetFolder) throw new AemError("AEM_TARGET_FOLDER is not configured, so nothing can be saved.", 400);
    const safeName = slug(name || title);
    if (!safeName) throw new AemError("A name or title is required.", 400);
    if (!modelPath) throw new AemError("The fragment has no model. Load an existing fragment of that model first.", 400);

    const path = `${targetFolder}/${safeName}`;
    const existing = await this.#request(`${this.#url(path)}.json`);
    if (existing.ok) throw new AemError(`${path} already exists. Choose another name.`, 409);

    const elements = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }]));
    const res = await this.#request(this.#url(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ properties: { "cq:model": modelPath, title: title || safeName, description: "", elements } }),
    });
    if (res.status === 409) throw new AemError(`${path} already exists. Choose another name.`, 409);
    if (!res.ok) throw new AemError(`AEM refused to create ${path} (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return { path, url: `${this.config.baseUrl}/ui#/aem/assetdetails.html${path}` };
  }
}

/** Siren response from the Assets HTTP API -> the shape the builder uses. */
export function normalizeFragment(path, body) {
  const props = body?.properties;
  if (!props || typeof props.elements !== "object" || props.elements === null) {
    throw new AemError(`${path} is not a content fragment (no elements). Is the link to a fragment, not a folder or an image?`, 422);
  }
  const fields = {};
  for (const [key, element] of Object.entries(props.elements)) {
    fields[key] = element !== null && typeof element === "object" && "value" in element ? element.value : element;
  }
  const modelPath = props["cq:model"];
  return {
    path,
    name: props.name ?? path.split("/").pop(),
    title: props.title ?? props.name ?? path.split("/").pop(),
    model: modelName(modelPath) || "Fragment",
    modelPath,
    fields,
  };
}
