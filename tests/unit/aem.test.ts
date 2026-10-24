import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM without types
import { AemClient, loadConfig, parseAemLink, modelName } from "../../server/aem.mjs";
// @ts-expect-error plain ESM without types
import { createApiHandler } from "../../server/index.mjs";
// @ts-expect-error plain ESM without types
import { startFakeAem } from "../helpers/fake-aem.mjs";
import { createServer, type Server } from "node:http";

const MODEL = "/conf/acme/settings/dam/cfm/models/hero-banner";
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});

describe("parseAemLink", () => {
  const path = "/content/dam/acme/summer-sale";
  it.each([
    ["Cloud Service asset details", `https://author-p1-e2.adobeaemcloud.com/ui#/aem/assetdetails.html${path}`],
    ["6.5 fragment editor", `https://aem.corp.example:4502/editor.html${path}`],
    ["Experience Cloud shell", `https://experience.adobe.com/#/@acme/aem/cf/editor/editor${path}`],
    ["assets console with query", `https://aem.corp.example/assets.html${path}?x=1`],
    ["json rendition", `https://aem.corp.example${path}.json`],
    ["encoded", `https://aem.corp.example/editor.html${encodeURI(path)}`],
    ["bare path", path],
  ])("%s", (_name, link) => {
    expect(parseAemLink(link)?.path).toBe(path);
  });
  it("rejects links without a DAM path or at the DAM root", () => {
    expect(parseAemLink("https://example.com/page.html")).toBeUndefined();
    expect(parseAemLink("https://aem.example/assets.html/content/dam")).toBeUndefined();
    expect(parseAemLink(undefined)).toBeUndefined();
  });
});

describe("config", () => {
  it("detects flavor from the host and builds the right auth header", () => {
    expect(loadConfig({ AEM_BASE_URL: "https://author-p1-e2.adobeaemcloud.com", AEM_TOKEN: "t" })).toMatchObject({ flavor: "cloud", authorization: "Bearer t" });
    const on65 = loadConfig({ AEM_BASE_URL: "https://aem.corp.example:4502/", AEM_USER: "a", AEM_PASSWORD: "b" });
    expect(on65).toMatchObject({ flavor: "65", baseUrl: "https://aem.corp.example:4502" });
    expect(on65.authorization).toBe(`Basic ${Buffer.from("a:b").toString("base64")}`);
  });
  it("is undefined when AEM is not configured and rejects a target folder outside the DAM", () => {
    expect(loadConfig({})).toBeUndefined();
    expect(() => loadConfig({ AEM_BASE_URL: "http://x", AEM_TARGET_FOLDER: "/content/other" })).toThrow(/inside \/content\/dam/);
  });
  it("names models", () => expect(modelName(MODEL)).toBe("HeroBanner"));
});

// The same client must work against both platforms, with their different auth.
describe.each(["cloud", "65"] as const)("AemClient against a fake AEM (%s)", (flavor) => {
  async function setup(auth: Record<string, string> = flavor === "cloud" ? { AEM_TOKEN: "test-token" } : { AEM_USER: "admin", AEM_PASSWORD: "secret" }) {
    const aem = await startFakeAem({ flavor });
    closers.push(aem.close);
    aem.seed("/content/dam/acme/summer-sale", MODEL, "Summer Sale", { headline: "Summer Sale", featured: true });
    const config = loadConfig({ AEM_BASE_URL: aem.url, AEM_FLAVOR: flavor, AEM_TARGET_FOLDER: "/content/dam/generated", ...auth });
    return { aem, client: new AemClient(config) };
  }

  it("reads and normalizes a fragment", async () => {
    const { client } = await setup();
    expect(await client.readFragment("/content/dam/acme/summer-sale")).toEqual({
      path: "/content/dam/acme/summer-sale",
      name: "summer-sale",
      title: "Summer Sale",
      model: "HeroBanner",
      modelPath: MODEL,
      fields: { headline: "Summer Sale", featured: true },
    });
  });

  it("explains missing assets, non-fragments and bad credentials", async () => {
    const { client, aem } = await setup();
    await expect(client.readFragment("/content/dam/acme/nope")).rejects.toMatchObject({ status: 404 });
    aem.store.set("/content/dam/acme/img", { name: "img" });
    await expect(client.readFragment("/content/dam/acme/img")).rejects.toThrow(/not a content fragment/);

    const { client: wrong } = await setup({ AEM_TOKEN: "wrong", AEM_USER: "nobody", AEM_PASSWORD: "x" });
    await expect(wrong.readFragment("/content/dam/acme/summer-sale")).rejects.toMatchObject({ status: 401 });
  });

  it("treats a login redirect as an auth failure", async () => {
    const { client } = await setup({});
    await expect(client.readFragment("/content/dam/acme/summer-sale")).rejects.toMatchObject({ status: 401 });
  });

  it("creates fragments in the target folder and never overwrites", async () => {
    const { client, aem } = await setup();
    const created = await client.createFragment({ name: "Autumn Promo!", title: "Autumn Promo", modelPath: MODEL, fields: { headline: "Autumn" } });
    expect(created.path).toBe("/content/dam/generated/autumn-promo");
    expect(aem.store.get(created.path)).toMatchObject({ "cq:model": MODEL, title: "Autumn Promo", elements: { headline: { value: "Autumn" } } });
    await expect(client.createFragment({ name: "autumn-promo", modelPath: MODEL, fields: {} })).rejects.toMatchObject({ status: 409 });
  });

  it("validates create input", async () => {
    const { client } = await setup();
    await expect(client.createFragment({ name: "", title: "", modelPath: MODEL, fields: {} })).rejects.toThrow(/name or title/);
    await expect(client.createFragment({ name: "x", modelPath: undefined, fields: {} })).rejects.toThrow(/no model/);
  });
});

describe("HTTP API", () => {
  async function api(env: Record<string, string>) {
    const aem = await startFakeAem({ flavor: "cloud" });
    closers.push(aem.close);
    aem.seed("/content/dam/acme/summer-sale", MODEL, "Summer Sale", { headline: "Hi" });
    const handler = createApiHandler(env.AEM_BASE_URL === "" ? undefined : loadConfig({ AEM_BASE_URL: aem.url, AEM_TOKEN: "test-token", AEM_FLAVOR: "cloud", AEM_TARGET_FOLDER: "/content/dam/generated", ...env }));
    const server: Server = createServer(handler);
    await new Promise<void>((r) => server.listen(0, r));
    closers.push(() => new Promise((r) => server.close(r)));
    const base = `http://localhost:${(server.address() as { port: number }).port}`;
    const post = (p: string, body: unknown) => fetch(base + p, { method: "POST", body: JSON.stringify(body) });
    return { base, post };
  }

  it("resolves a pasted link", async () => {
    const { post } = await api({});
    const res = await post("/api/aem/resolve", { link: "https://author-p1-e2.adobeaemcloud.com/ui#/aem/assetdetails.html/content/dam/acme/summer-sale" });
    expect(res.status).toBe(200);
    expect((await res.json()).fragment).toMatchObject({ title: "Summer Sale", fields: { headline: "Hi" } });
  });

  it("reports config and errors clearly", async () => {
    const { base, post } = await api({});
    expect(await (await fetch(`${base}/api/aem/config`)).json()).toMatchObject({ configured: true, flavor: "cloud", targetFolder: "/content/dam/generated" });
    expect((await post("/api/aem/resolve", { link: "https://example.com" })).status).toBe(400);
    expect((await post("/api/aem/resolve", { link: "/content/dam/acme/missing" })).status).toBe(404);
  });

  it("answers 503 with guidance when AEM is not configured", async () => {
    const { base, post } = await api({ AEM_BASE_URL: "" });
    expect(await (await fetch(`${base}/api/aem/config`)).json()).toEqual({ configured: false });
    const res = await post("/api/aem/resolve", { link: "/content/dam/acme/x" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/AEM_BASE_URL/);
  });
});
