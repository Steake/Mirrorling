import { defineConfig } from "@playwright/test";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 20_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4312",
    trace: "retain-on-failure",
    launchOptions: chromiumExecutable
      ? {
          executablePath: chromiumExecutable,
          args: ["--no-sandbox"],
        }
      : undefined,
  },
  webServer: [
    {
      command: "npm run fixture:built",
      url: "http://127.0.0.1:4311/account",
      reuseExistingServer: false,
      timeout: 20_000,
    },
    {
      command: "npm start -- --config examples/demo/demo.config.json",
      url: "http://127.0.0.1:4312/__bench/health",
      reuseExistingServer: false,
      timeout: 20_000,
    },
  ],
});
