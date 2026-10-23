import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TypeChecker } from "../../src/engine/typecheck";

let checker: TypeChecker;

beforeAll(() => {
  // Same bundle the browser worker fetches: run `npm run build:types` first.
  const typeFiles = JSON.parse(readFileSync("public/types.json", "utf8"));
  checker = new TypeChecker(ts, typeFiles);
}, 60_000);

const check = (files: Record<string, string>) => checker.check(files);

describe("typecheck", () => {
  it("accepts valid code using React and the design system", () => {
    expect(
      check({
        "App.tsx": `import { useState } from "react";
import { Button, Stack } from "@ds/ui";
import "./x.css";
export default function App() {
  const [n, setN] = useState(0);
  return <Stack gap={2}><Button variant="secondary" onClick={() => setN(n + 1)}>{n}</Button></Stack>;
}`,
        "x.css": ".a{}",
      }),
    ).toEqual([]);
  });

  it("flags a design-system prop value that is not allowed", () => {
    const [d] = check({
      "App.tsx": `import { Button } from "@ds/ui";\nexport default () => <Button variant="danger">x</Button>;`,
    });
    expect(d).toMatchObject({ severity: "error", source: "typescript", code: 2322, file: "App.tsx", line: 2 });
    expect(d.message).toContain(`"danger"`);
  });

  it("flags missing required props and unknown props", () => {
    const messages = check({
      "App.tsx": `import { Input, Badge } from "@ds/ui";\nexport default () => <><Input label="a" /><Badge color="red" /></>;`,
    }).map((d) => d.message);
    expect(messages.some((m) => /value/.test(m))).toBe(true);
    expect(messages.some((m) => /color/.test(m))).toBe(true);
  });

  it("flags plain TypeScript errors with line and column", () => {
    const [d] = check({ "App.tsx": `const n: number = "s";\nexport default () => <div>{n}</div>;` });
    expect(d).toMatchObject({ line: 1, column: 6, code: 2322 });
  });

  it("follows imports across files and picks up edits and deletions", () => {
    const files = {
      "App.tsx": `import { label } from "./lib";\nexport default () => <p>{label.nope}</p>;`,
      "lib.ts": `export const label = "text";`,
    };
    expect(check(files).map((d) => d.code)).toEqual([2339]);
    expect(check({ ...files, "lib.ts": `export const label = { nope: 1 };` })).toEqual([]);
    expect(check({ "App.tsx": `export default () => <p />;` })).toEqual([]);
  });

  it("does not report problems in declaration or library files", () => {
    const diagnostics = check({ "App.tsx": `export default () => <p />;` });
    expect(diagnostics).toEqual([]);
  });
});
