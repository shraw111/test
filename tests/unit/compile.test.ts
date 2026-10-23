import * as esbuild from "esbuild-wasm";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/engine/compile";
import { resolveFile, normalize } from "../../src/engine/paths";

describe("compile", () => {
  it("bundles local files and keeps react and the design system external", async () => {
    const result = await compile(esbuild, {
      "App.tsx": `import { Button } from "@ds/ui";\nimport { label } from "./lib/label";\nexport default () => <Button>{label}</Button>;`,
      "lib/label.ts": `export const label = "Hi";`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.js).toMatch(/from "@ds\/ui"/);
    expect(result.js).toMatch(/from "react\/jsx-runtime"/);
    expect(result.js).toContain(`"Hi"`);
  });

  it("emits imported CSS separately", async () => {
    const result = await compile(esbuild, {
      "App.tsx": `import "./styles.css";\nexport default () => <div className="x" />;`,
      "styles.css": `.x { color: red; }`,
    });
    expect(result.ok && result.css).toContain("color: red");
  });

  it("rejects packages outside the allowlist", async () => {
    const result = await compile(esbuild, {
      "App.tsx": `import _ from "lodash";\nexport default () => <div>{_.x}</div>;`,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain(`Package "lodash" is not available`);
    expect(result.errors[0].file).toBe("App.tsx");
    expect(result.errors[0].line).toBe(1);
  });

  it("reports missing local files and syntax errors with locations", async () => {
    const missing = await compile(esbuild, { "App.tsx": `import x from "./nope";\nexport default x;` });
    expect(!missing.ok && missing.errors[0].message).toContain(`Cannot find file "./nope"`);

    const syntax = await compile(esbuild, { "App.tsx": `export default () => <div>;` });
    expect(syntax.ok).toBe(false);
    if (!syntax.ok) expect(syntax.errors[0]).toMatchObject({ file: "App.tsx", line: 1 });
  });

  it("requires an entry file", async () => {
    const result = await compile(esbuild, { "Other.tsx": "export default 1" });
    expect(!result.ok && result.errors[0].message).toContain("No entry file");
  });
});

describe("paths", () => {
  it("normalizes and resolves like a bundler", () => {
    expect(normalize("/components/../lib/./x")).toBe("/lib/x");
    const files = { "lib/index.ts": "", "Card.tsx": "" };
    expect(resolveFile(files, "/lib")).toBe("/lib/index.ts");
    expect(resolveFile(files, "/Card")).toBe("/Card.tsx");
    expect(resolveFile(files, "/Nope")).toBeUndefined();
  });
});
