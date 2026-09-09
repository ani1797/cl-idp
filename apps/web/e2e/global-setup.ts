import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const webRoot = path.resolve(__dirname, "..");
const apiRoot = path.resolve(webRoot, "../api");
const stateDir = path.join(webRoot, ".playwright");
const statePath = path.join(stateDir, "worker-state.json");
const logPath = path.join(stateDir, "worker.log");

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
}
