import fs from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const webRoot = __dirname;
const apiRoot = path.resolve(webRoot, "../api");
const apiBaseUrl = "http://localhost:8010";
const webBaseUrl = "http://localhost:3100";
const chromeExecutableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "/usr/sbin/google-chrome-stable",
  "/usr/bin/google-chrome-stable",
].filter((candidate): candidate is string => Boolean(candidate));
const chromeExecutablePath = chromeExecutableCandidates.find((candidate) => fs.existsSync(candidate));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 10 * 60 * 1000,
  expect: {
    timeout: 2 * 60 * 1000,
  },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: webBaseUrl,
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  webServer: [
    {
      command: "uv run uvicorn app.main:app --host 127.0.0.1 --port 8010",
      cwd: apiRoot,
      url: `${apiBaseUrl}/healthz`,
      timeout: 3 * 60 * 1000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        WEB_ORIGIN: webBaseUrl,
        NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
      },
    },
    {
      command: "rm -rf .next && npm run dev -- --hostname 127.0.0.1 --port 3100",
      cwd: webRoot,
      url: webBaseUrl,
      timeout: 3 * 60 * 1000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromeExecutablePath
          ? {
              executablePath: chromeExecutablePath,
            }
          : undefined,
      },
    },
  ],
});
