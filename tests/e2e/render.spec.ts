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
  await expect(preview(page).getByText("origin=null parent=blocked storage=blocked net=blocked")).toBeVisible();
});

test("a module that throws while loading keeps the previous build on screen", async ({ page }) => {
  await setCode(page, `export default () => <h1>Good build</h1>;`);
  await expect(preview(page).getByRole("heading", { name: "Good build" })).toBeVisible();

  await setCode(page, `throw new Error("top-level failure");\nexport default () => <h1>Never</h1>;`);
  await expect(status(page)).toHaveText("Runtime error");
  await expect(page.getByTestId("problems-panel")).toContainText("top-level failure");
  await expect(preview(page).getByRole("heading", { name: "Good build" })).toBeVisible();
});
