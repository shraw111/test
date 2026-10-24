import { expect, test, type Page } from "@playwright/test";

const preview = (page: Page) => page.frameLocator('iframe[title="Preview"]');
const status = (page: Page) => page.getByTestId("status");
const FAKE_AEM = "http://localhost:5190";
const LINK = "https://author-p1-e2.adobeaemcloud.com/ui#/aem/assetdetails.html/content/dam/acme/summer-sale";

const setCode = (page: Page, code: string) => page.getByLabel("Code editor").fill(code);
const openContent = (page: Page) => page.getByRole("button", { name: /^Content/ }).click();
const settled = (page: Page) => expect(status(page)).toHaveText(/^Rendered · built in \d+ ms( · \d+ type errors?)?$/, { timeout: 30_000 });

const useLive = (extra = "") => `import { useFragment } from "@aem/content";
export default function App() {
  const { data, error } = useFragment("/content/dam/acme/summer-sale");
  if (error) return <p>{error}</p>;
  return <h1>{data?.headline ?? "…"}{data ? " / " + data.subhead : ""}</h1>;
}${extra}`;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toContainText("Rendered", { timeout: 15_000 });
});

test("sample content works out of the box, with typed fields and a live list", async ({ page }) => {
  await page.getByLabel("Example").selectOption("AEM content fragments");
  await expect(preview(page).getByText("Summer Sale").first()).toBeVisible();
  await expect(preview(page).getByText("Up to 40% off everything").first()).toBeVisible();
  await expect(preview(page).getByRole("button", { name: "Shop now" })).toBeVisible();
  await expect(preview(page).getByText("New Arrivals")).toBeVisible(); // from useFragmentList
  await settled(page);
  await expect(status(page)).not.toContainText("type error");
});

test("pasting an AEM link loads the fragment and the preview uses it", async ({ page }) => {
  await openContent(page);
  await expect(page.getByTestId("aem-status")).toContainText("Connected to localhost:5190 (Cloud Service)");
  await expect(page.getByTestId("aem-status")).toContainText("/content/dam/generated");

  await page.getByLabel("AEM link").fill(LINK);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Loaded /content/dam/acme/summer-sale" })).toBeVisible();
  await expect(page.locator(".badge-aem")).toHaveCount(1);

  await setCode(page, useLive());
  await expect(preview(page).getByText("Summer Sale from AEM / Live content, not a sample")).toBeVisible();
});

test("code that points at a fragment that is not loaded is flagged until it is", async ({ page }) => {
  await setCode(page, useLive());
  await expect(status(page)).toContainText("type error", { timeout: 30_000 });
  await openContent(page);
  await expect(preview(page).getByText(/No content fragment at \/content\/dam\/acme\/summer-sale/)).toBeVisible();

  await page.getByLabel("AEM link").fill(LINK);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  // The new content changes the types, which re-checks, and the hook refetches.
  await expect(preview(page).getByText("Summer Sale from AEM")).toBeVisible({ timeout: 30_000 });
  await expect(status(page)).toHaveText(/^Rendered · built in \d+ ms$/, { timeout: 30_000 });
});

test("a field that is not in the model is a type error", async ({ page }) => {
  await page.getByLabel("Example").selectOption("AEM content fragments");
  await setCode(
    page,
    `import { useFragment } from "@aem/content";
export default () => <h1>{useFragment("/content/dam/sample/summer-sale").data?.subtitle}</h1>;`,
  );
  await expect(status(page)).toContainText("1 type error", { timeout: 30_000 });
  await expect(page.getByTestId("problems-panel")).toContainText("Property 'subtitle' does not exist");
});

test("bad links and non-fragments give clear errors", async ({ page }) => {
  await openContent(page);
  const load = async (link: string) => {
    await page.getByLabel("AEM link").fill(link);
    await page.getByRole("button", { name: "Load", exact: true }).click();
  };
  await load("https://example.com/not-aem");
  await expect(page.getByRole("alert")).toContainText("doesn't look like a link to a content fragment");
  await load("/content/dam/acme/does-not-exist");
  await expect(page.getByRole("alert")).toContainText("No asset at /content/dam/acme/does-not-exist");
  await load("/content/dam/acme/photo");
  await expect(page.getByRole("alert")).toContainText("is not a content fragment");
});

test("drafts: duplicate, edit fields live, then save to the fixed folder after confirming", async ({ page, request }) => {
  const title = `Autumn ${Date.now()}`;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const draftPath = `/content/dam/generated/${slug}`;

  await openContent(page);
  await page.getByLabel("AEM link").fill(LINK);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.locator(".badge-aem")).toHaveCount(1);

  // New draft from the model of a loaded fragment, then edit its fields.
  await page.getByLabel("Model").selectOption("HeroBanner");
  await page.getByLabel("New fragment title").fill(title);
  await page.getByRole("button", { name: "New draft" }).click();
  await expect(page.locator(".badge-draft")).toHaveCount(1);

  await setCode(page, `import { useFragment } from "@aem/content";
export default function App() {
  const { data } = useFragment("${draftPath}");
  return <h1>{data ? data.headline + " | " + data._title : "…"}</h1>;
}`);
  await expect(preview(page).getByText(`| ${title}`)).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Fragment fields").fill(JSON.stringify({ headline: "Edited headline", subhead: "s", ctaLabel: "c", featured: true, tags: [] }, null, 2));
  await expect(preview(page).getByText(`Edited headline | ${title}`)).toBeVisible();

  // Invalid JSON is reported and does not clobber the preview.
  await page.getByLabel("Fragment fields").fill("{ nope");
  await expect(page.getByText(/JSON|Expected|Unexpected/).first()).toBeVisible();
  await expect(preview(page).getByText(`Edited headline | ${title}`)).toBeVisible();
  await page.getByLabel("Fragment fields").fill(JSON.stringify({ headline: "Final headline", subhead: "s", ctaLabel: "c", featured: true, tags: [] }));

  // Declining the confirmation writes nothing.
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Save to AEM" }).click();
  expect((await request.get(`${FAKE_AEM}/api/assets/generated/${slug}.json`, { headers: { Authorization: "Bearer test-token" } })).status()).toBe(404);

  // Accepting creates it in the configured folder, with the confirmation naming it.
  let confirmText = "";
  page.once("dialog", (d) => {
    confirmText = d.message();
    void d.accept();
  });
  await page.getByRole("button", { name: "Save to AEM" }).click();
  await expect(page.getByText(`Saved to AEM: ${draftPath}`)).toBeVisible();
  expect(confirmText).toContain(draftPath);
  expect(confirmText).toContain("never overwritten");

  const saved = await request.get(`${FAKE_AEM}/api/assets/generated/${slug}.json`, { headers: { Authorization: "Bearer test-token" } });
  expect(saved.status()).toBe(200);
  expect((await saved.json()).properties).toMatchObject({
    title,
    "cq:model": "/conf/acme/settings/dam/cfm/models/hero-banner",
    elements: { headline: { value: "Final headline" } },
  });
  await expect(page.locator(".badge-draft")).toHaveCount(0);
  await expect(preview(page).getByText(`Final headline | ${title}`)).toBeVisible();
});

test("samples cannot be saved to AEM, with an explanation", async ({ page }) => {
  await openContent(page);
  await page.getByRole("button", { name: "Duplicate as draft" }).first().click();
  await expect(page.getByRole("button", { name: "Save to AEM" })).toBeDisabled();
  await expect(page.getByText(/Sample models can't be saved/)).toBeVisible();
});

test("saving never overwrites an existing fragment", async ({ page }) => {
  await openContent(page);
  await page.getByLabel("AEM link").fill(LINK);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.getByLabel("Model").selectOption("HeroBanner");
  const title = `Dup ${Date.now()}`;
  for (let i = 0; i < 2; i++) {
    await page.getByLabel("New fragment title").fill(i === 0 ? title : `${title}!`); // same slug
    await page.getByRole("button", { name: "New draft" }).click();
    if (i === 0) {
      page.once("dialog", (d) => void d.accept());
      await page.getByRole("button", { name: "Save to AEM" }).click();
      await expect(page.getByText(/Saved to AEM/)).toBeVisible();
    }
  }
  // The second draft collides with the saved fragment's path in the local store.
  await expect(page.getByRole("alert")).toContainText("already exists");
});
