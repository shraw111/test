import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  // Pages run a compile worker and a TypeScript worker each; with parallel workers a render can take a while.
  expect: { timeout: 15_000 },
  use: { baseURL: "http://localhost:5180", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    // Stands in for a real AEM author instance (Cloud Service flavor: bearer auth).
    { command: "node tests/helpers/fake-aem.mjs", port: 5190, reuseExistingServer: !process.env.CI },
    {
      command: "npm run dev",
      url: "http://localhost:5180",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        AEM_BASE_URL: "http://localhost:5190",
        AEM_FLAVOR: "cloud",
        AEM_TOKEN: "test-token",
        AEM_TARGET_FOLDER: "/content/dam/generated",
      },
    },
  ],
});
