import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";

import { request as playwrightRequest } from "@playwright/test";

const webRoot = path.resolve(__dirname, "..");
const apiRoot = path.resolve(webRoot, "../api");
const stateDir = path.join(webRoot, ".playwright");
const statePath = path.join(stateDir, "worker-state.json");
const logPath = path.join(stateDir, "worker.log");
export const e2eStorageStatePath = path.join(stateDir, "storage-state.json");
// Every browser call is routed through the web app's own /api-proxy route
// handler (see app/api-proxy/[...path]/route.ts), so the pre-authenticated
// session cookie must be scoped to the *web* origin, not the api's own
// origin, or the browser won't attach it to any /api-proxy/* request.
const webBaseUrl = "http://localhost:3100";

type WorkerState = {
  pid: number;
};

function readWorkerState(): WorkerState | null {
  if (!fs.existsSync(statePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(statePath, "utf8")) as WorkerState;
}

function tryStopWorker(pid: number) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
}

async function waitForWorker(pid: number) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Timed out waiting for worker process ${pid} to stay alive.`);
}

async function ensureE2eUser(): Promise<{ email: string; password: string }> {
  const output = execFileSync(
    "uv",
    ["run", "python", "scripts/e2e_support.py", "ensure-e2e-user"],
    { cwd: apiRoot, env: process.env, encoding: "utf8", stdio: "pipe" },
  );

  return JSON.parse(output) as { email: string; password: string };
}

async function createAuthenticatedStorageState() {
  const { email, password } = await ensureE2eUser();

  const context = await playwrightRequest.newContext({ baseURL: webBaseUrl });
  try {
    const response = await context.post("/api-proxy/auth/login", { data: { email, password } });
    if (!response.ok()) {
      throw new Error(
        `E2E login failed: ${response.status()} ${await response.text().catch(() => "")}`,
      );
    }
    await context.storageState({ path: e2eStorageStatePath });
  } finally {
    await context.dispose();
  }
}

export default async function globalSetup() {
  fs.mkdirSync(stateDir, { recursive: true });

  const existingState = readWorkerState();
  if (existingState) {
    tryStopWorker(existingState.pid);
    fs.rmSync(statePath, { force: true });
  }

  const logFd = fs.openSync(logPath, "a");
  const worker = spawn("uv", ["run", "python", "-m", "app.worker.main"], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
    },
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  fs.closeSync(logFd);
  if (worker.pid === undefined) {
    throw new Error("Worker process did not expose a PID.");
  }
  worker.unref();
  fs.writeFileSync(statePath, JSON.stringify({ pid: worker.pid }));
  await waitForWorker(worker.pid);

  // The API/worker webServer plugins have already started and passed their
  // health checks by this point, so it's safe to seed the fixed e2e test
  // user and pre-authenticate a session for every test.
  await createAuthenticatedStorageState();
}
