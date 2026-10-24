import { expect, test, type Page } from "@playwright/test";

const preview = (page: Page) => page.frameLocator('iframe[title="Preview"]');
const status = (page: Page) => page.getByTestId("status");

async function setCode(page: Page, code: string) {
  await page.getByLabel("Code editor").fill(code);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toContainText("Rendered", { timeout: 15_000 });
});

test("renders a multi-file design system page with working hooks", async ({ page }) => {
  const frame = preview(page);
  await expect(frame.getByText("Pricing")).toBeVisible();
  await expect(frame.getByText("Acme Cloud")).toBeVisible();
  await expect(frame.locator(".plans .ds-card")).toHaveCount(3);

  // useState in generated code
  await frame.getByRole("button", { name: "Yearly" }).click();
  await expect(frame.getByText("2 months free")).toBeVisible();
  await expect(frame.getByText("$290")).toBeVisible();

  // useState inside the DS bundle: only works if both share one React
  await frame.getByRole("button", { name: /Can I change plans later/ }).click();
  await expect(frame.getByText(/Upgrades apply immediately/)).toBeVisible();

  // DS CSS and the project's own CSS both applied
  await expect(frame.locator(".ds-shell__top")).toHaveCSS("font-weight", "700");
  await expect(frame.locator(".plans")).toHaveCSS("display", "grid");

  await page.getByRole("button", { name: /Console/ }).click();
  await expect(page.getByTestId("console-panel")).not.toContainText("Invalid hook call");
});

test("re-renders when code is edited", async ({ page }) => {
  await page.getByLabel("Example").selectOption("Plain React counter");
  await expect(preview(page).getByRole("heading", { name: "Count: 0" })).toBeVisible();

  await setCode(page, `export default function App() { return <h1>Edited live</h1>; }`);
  await expect(preview(page).getByRole("heading", { name: "Edited live" })).toBeVisible();
});

test("compile errors are reported and the last good build stays on screen", async ({ page }) => {
  await page.getByLabel("Example").selectOption("Plain React counter");
  await expect(preview(page).getByRole("heading", { name: "Count: 0" })).toBeVisible();

  await page.getByLabel("Example").selectOption("Disallowed import");
  await expect(status(page)).toHaveText("Compile error");
  await expect(page.getByTestId("problems-panel")).toContainText('Package "lodash" is not available');
  await expect(page.getByTestId("problems-panel")).toContainText("App.tsx:1:");
  await expect(preview(page).getByRole("heading", { name: "Count: 0" })).toBeVisible();
});

test("runtime errors inside the preview are reported back", async ({ page }) => {
  await page.getByLabel("Example").selectOption("Runtime error");
  await expect(status(page)).toContainText("Rendered");
  await preview(page).getByRole("button", { name: "Break it" }).click();
  await expect(status(page)).toHaveText("Runtime error");
  await expect(page.getByTestId("problems-panel")).toContainText("Broken component failed to render");
  await expect(preview(page).getByText(/Render error/)).toBeVisible();
});

test("console output is forwarded", async ({ page }) => {
  await setCode(page, `console.warn("hello from preview");\nexport default () => <p>ok</p>;`);
  await expect(preview(page).getByText("ok")).toBeVisible();
  await page.getByRole("button", { name: /Console/ }).click();
  await expect(page.getByTestId("console-panel")).toContainText("hello from preview");
});

test("generated code is isolated from the app and the network", async ({ page }) => {
  await setCode(
    page,
    `import { useEffect, useState } from "react";
export default function App() {
  const [net, setNet] = useState("pending");
  useEffect(() => {
    fetch("https://example.com").then(() => setNet("allowed"), () => setNet("blocked"));
  }, []);
  let storage = "available";
  try { localStorage.getItem("x"); } catch { storage = "blocked"; }
  return <p>origin={String(window.origin)} parent={String((() => { try { return window.parent.document.title } catch { return "blocked" } })())} storage={storage} net={net}</p>;
}`,
  );
  await expect(preview(page).getByText("origin=null parent=blocked storage=blocked net=blocked")).toBeVisible({ timeout: 20_000 });
});

test("a module that throws while loading keeps the previous build on screen", async ({ page }) => {
  await setCode(page, `export default () => <h1>Good build</h1>;`);
  await expect(preview(page).getByRole("heading", { name: "Good build" })).toBeVisible();

  await setCode(page, `throw new Error("top-level failure");\nexport default () => <h1>Never</h1>;`);
  await expect(status(page)).toHaveText("Runtime error");
  await expect(page.getByTestId("problems-panel")).toContainText("top-level failure");
  await expect(preview(page).getByRole("heading", { name: "Good build" })).toBeVisible();
});

test.describe("type checking", () => {
  test("a valid project reports no type errors", async ({ page }) => {
    await expect(status(page)).not.toContainText("checking types", { timeout: 30_000 });
    await expect(status(page)).not.toContainText("type error");
    await expect(page.getByRole("button", { name: /Problems \(0\)/ })).toBeVisible();
  });

  test("a wrong design-system prop is flagged inline and in the problems panel but still renders", async ({ page }) => {
    await setCode(
      page,
      `import { Button } from "@ds/ui";\nexport default () => <Button variant="danger">Delete</Button>;`,
    );
    await expect(preview(page).getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(status(page)).toContainText("1 type error", { timeout: 30_000 });
    await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);
    await expect(page.getByTestId("problems-panel")).toContainText("TS2322");
    await expect(page.getByTestId("problems-panel")).toContainText('"danger"');
    await expect(page.getByTestId("problems-panel")).toContainText("App.tsx:2:");
  });

  test("fixing the error clears it", async ({ page }) => {
    await setCode(page, `import { Button } from "@ds/ui";\nexport default () => <Button variant="nope">x</Button>;`);
    await expect(status(page)).toContainText("1 type error", { timeout: 30_000 });
    await setCode(page, `import { Button } from "@ds/ui";\nexport default () => <Button variant="ghost">x</Button>;`);
    await expect(status(page)).toHaveText(/^Rendered · built in \d+ ms$/, { timeout: 30_000 });
    await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
  });

  test("the editor highlights code and keeps one editor per file", async ({ page }) => {
    await expect(page.locator(".cm-content .tok-keyword, .cm-content [class*='ͼ']").first()).toBeVisible();
    await page.getByRole("tab", { name: "styles.css" }).click();
    await expect(page.locator(".cm-content")).toContainText(".plans");
    await expect(page.locator(".cm-editor")).toHaveCount(1);
  });
});

test.describe("typeCheck=block (how model output will be gated)", () => {
  test("a build with type errors does not replace the last good preview", async ({ page }) => {
    await page.goto("/?typeCheck=block");
    await expect(preview(page).getByText("Pricing")).toBeVisible({ timeout: 30_000 });

    await setCode(page, `import { Button } from "@ds/ui";\nexport default () => <Button variant="danger">Bad build</Button>;`);
    await expect(status(page)).toContainText("1 type error", { timeout: 30_000 });
    await expect(preview(page).getByText("Bad build")).toHaveCount(0);
    await expect(preview(page).getByText("Pricing")).toBeVisible();

    await setCode(page, `import { Button } from "@ds/ui";\nexport default () => <Button variant="ghost">Good build</Button>;`);
    await expect(preview(page).getByText("Good build")).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("typeCheck=off", () => {
  test("never downloads TypeScript or the type bundle", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));
    await page.goto("/?typeCheck=off");
    await expect(preview(page).getByText("Pricing")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    expect(requested.filter((u) => /typecheck|types\.json/.test(u))).toEqual([]);
  });
});

test("an older build that finishes loading late never overwrites a newer one", async ({ page }) => {
  // Top-level await delays when import() of the OLD module resolves, so it
  // finishes after the NEW one even though it was sent first.
  const module = (text: string, delayMs: number) => `import { createElement as h } from "react";
await new Promise((r) => setTimeout(r, ${delayMs}));
export default () => h("p", null, "${text}");`;

  await page.evaluate(
    ({ oldJs, newJs }) => {
      const win = (document.querySelector('iframe[title="Preview"]') as HTMLIFrameElement).contentWindow!;
      win.postMessage({ type: "load", buildId: 9001, js: oldJs, css: "" }, "*");
      win.postMessage({ type: "load", buildId: 9002, js: newJs, css: "" }, "*");
    },
    { oldJs: module("OLD build", 800), newJs: module("NEW build", 0) },
  );

  await expect(preview(page).getByText("NEW build")).toBeVisible();
  await page.waitForTimeout(1500); // long enough for the OLD module to finish
  await expect(preview(page).getByText("NEW build")).toBeVisible();
  await expect(preview(page).getByText("OLD build")).toHaveCount(0);
});

test("a superseded build that fails to load reports nothing", async ({ page }) => {
  // Listen to the raw messages from the iframe: the app UI filters by build id,
  // so it would hide a wrongly attributed error.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    window.addEventListener("message", (e) => {
      if (e.data?.source === "ui-preview" && e.data.type === "runtime-error") seen.push(e.data.message);
    });
    const win = (document.querySelector('iframe[title="Preview"]') as HTMLIFrameElement).contentWindow!;
    const failing = `await new Promise((r) => setTimeout(r, 500)); throw new Error("stale failure");\nexport default () => null;`;
    const good = `import { createElement as h } from "react";\nexport default () => h("p", null, "Latest build");`;
    win.postMessage({ type: "load", buildId: 9101, js: failing, css: "" }, "*");
    win.postMessage({ type: "load", buildId: 9102, js: good, css: "" }, "*");
  });
  await expect(preview(page).getByText("Latest build")).toBeVisible();
  await page.waitForTimeout(1200); // the failing module has now settled
  expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toEqual([]);
});
