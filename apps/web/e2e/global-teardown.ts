import fs from "node:fs";
import path from "node:path";

const webRoot = path.resolve(__dirname, "..");
const statePath = path.join(webRoot, ".playwright", "worker-state.json");

type WorkerState = {
  pid: number;
};

function stopWorker(pid: number) {
  try {
    process.kill(-pid, "SIGTERM");
    return;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
}

export default async function globalTeardown() {
  if (!fs.existsSync(statePath)) {
    return;
  }

  const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as WorkerState;
  stopWorker(state.pid);
  fs.rmSync(statePath, { force: true });
}
