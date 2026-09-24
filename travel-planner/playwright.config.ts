import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  // Keep desktop/mobile browsers from saturating local development machines.
  workers: 2,
  timeout: 90_000,
  use: { baseURL: "http://127.0.0.1:5174", trace: "retain-on-failure", reducedMotion: "reduce" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: process.env.CI ? undefined : "chrome" } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", channel: process.env.CI ? undefined : "chrome" } },
  ],
  webServer: [
    { command: "npm run dev -- --port 5174", url: "http://127.0.0.1:5174", reuseExistingServer: !process.env.CI },
    { command: "npm run preview -- --host 127.0.0.1 --port 5175 --strictPort", url: "http://127.0.0.1:5175", reuseExistingServer: !process.env.CI, timeout: 120000 },
  ],
});
