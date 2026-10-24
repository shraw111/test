import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SAMPLE_FRAGMENTS } from "../../src/content/samples";
import { ContentStore } from "../../src/content/store";
import { contentTypeFiles, generateContentTypes } from "../../src/content/typegen";
import type { Fragment } from "../../src/content/types";
import { TypeChecker } from "../../src/engine/typecheck";

const frag = (path: string, model: string, fields: Record<string, unknown>): Fragment => ({
  path, name: path.split("/").pop()!, title: path, model, fields, source: "aem",
});

describe("generateContentTypes", () => {
  it("makes one interface per model with inferred field types", () => {
    const dts = generateContentTypes(SAMPLE_FRAGMENTS);
    expect(dts).toMatch(/export interface HeroBanner \{[^}]*headline: string;[^}]*ctaLabel: string;/s);
    expect(dts).toMatch(/export interface Article \{[^}]*tags: \(string\)\[\];[^}]*published: boolean;/s);
    expect(dts).toContain('"/content/dam/sample/summer-sale": HeroBanner;');
  });

  it("marks fields missing from some fragments optional and unions differing types", () => {
    const dts = generateContentTypes([
      frag("/content/dam/a", "Card", { title: "x", count: 1, extra: { a: 1 } }),
      frag("/content/dam/b", "Card", { title: "y", count: "many" }),
    ]);
    expect(dts).toContain("extra?: { a: number };");
    expect(dts).toContain("count: number | string;");
  });

  it("quotes field names that are not identifiers and handles no content", () => {
    expect(generateContentTypes([frag("/content/dam/a", "M", { "hero-image": "x" })])).toContain('"hero-image": string;');
    expect(generateContentTypes([])).toContain("export interface FragmentMap {\n\n}");
  });
});

describe("ContentStore", () => {
  it("creates drafts with the model's shape in the target folder", () => {
    const store = new ContentStore();
    store.targetFolder = "/content/dam/generated";
    const draft = store.createDraft("Article", "My New Article!");
    expect(draft).toMatchObject({ path: "/content/dam/generated/my-new-article", source: "draft", fields: { title: "", body: "", tags: [], published: false } });
    expect(() => store.createDraft("Article", "My New Article!")).toThrow(/already exists/);
    expect(() => store.createDraft("Nope", "x")).toThrow(/Unknown model/);
  });

  it("builds drafts from an AEM fragment of the model when one is loaded, so they can be saved", () => {
    const store = new ContentStore();
    expect(store.createDraft("HeroBanner", "From sample").modelPath).toBeUndefined();
    store.put({ ...frag("/content/dam/acme/hero", "HeroBanner", { headline: "h", subhead: "s", ctaLabel: "c" }), modelPath: "/conf/acme/models/hero-banner" });
    expect(store.createDraft("HeroBanner", "From aem").modelPath).toBe("/conf/acme/models/hero-banner");
  });

  it("duplicates without clobbering and notifies subscribers", () => {
    const store = new ContentStore();
    let changes = 0;
    store.subscribe(() => changes++);
    const a = store.duplicateAsDraft("/content/dam/sample/summer-sale");
    const b = store.duplicateAsDraft("/content/dam/sample/summer-sale");
    expect(a.path).not.toBe(b.path);
    expect(store.get("/content/dam/sample/summer-sale")?.source).toBe("sample");
    expect(changes).toBe(2);
  });

  it("serves data with metadata, lists by model and explains unknown paths", () => {
    const store = new ContentStore();
    expect(store.data("/content/dam/sample/summer-sale")).toMatchObject({ _path: "/content/dam/sample/summer-sale", _title: "Summer Sale", headline: "Summer Sale" });
    expect(store.list("HeroBanner")).toHaveLength(2);
    expect(() => store.data("/content/dam/x")).toThrow(/No content fragment at \/content\/dam\/x\. Available: /);
  });
});

describe("type-checking generated code against content", () => {
  let checker: TypeChecker;
  beforeAll(() => {
    checker = new TypeChecker(ts, JSON.parse(readFileSync("public/types.json", "utf8")));
  }, 60_000);
  const ambient = contentTypeFiles(SAMPLE_FRAGMENTS);
  const check = (code: string, a = ambient) => checker.check({ "App.tsx": code }, a).map((d) => d.message);

  it("accepts real paths and fields", () => {
    expect(check(`import { useFragment, useFragmentList } from "@aem/content";
export default function App() {
  const { data } = useFragment("/content/dam/sample/summer-sale");
  const list = useFragmentList("Article");
  return <p>{data?.headline}{data?._title}{list.data?.map((a) => a.tags.join(","))}</p>;
}`)).toEqual([]);
  });

  it("flags a field the model does not have", () => {
    const [message] = check(`import { useFragment } from "@aem/content";
export default () => <p>{useFragment("/content/dam/sample/summer-sale").data?.subtitle}</p>;`);
    expect(message).toMatch(/Property 'subtitle' does not exist/);
  });

  it("flags an invented path and an unknown model", () => {
    const messages = check(`import { useFragment, useFragmentList } from "@aem/content";
export default () => <p>{String(useFragment("/content/dam/made/up").data)}{String(useFragmentList("Nope").data)}</p>;`);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatch(/not assignable to parameter of type/);
  });

  it("picks up newly loaded content and drops removed content", () => {
    const code = `import { useFragment } from "@aem/content";\nexport default () => <p>{useFragment("/content/dam/new/one").data?.extra}</p>;`;
    expect(check(code)).not.toEqual([]);
    const loaded = contentTypeFiles([...SAMPLE_FRAGMENTS, frag("/content/dam/new/one", "Promo", { extra: "x" })]);
    expect(check(code, loaded)).toEqual([]);
    expect(check(code)).not.toEqual([]);
  });
});
