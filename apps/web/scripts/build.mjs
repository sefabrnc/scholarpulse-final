import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const maxAttempts = process.platform === "win32" ? 6 : 3;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextDir = path.join(webRoot, ".next");
const nextCli = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
let lastStatus = 1;

function sleepMs(ms) {
  if (typeof Atomics !== "undefined" && typeof SharedArrayBuffer !== "undefined") {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    return;
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy wait fallback for older Node builds.
  }
}

function cleanNextOutput() {
  try {
    rmSync(nextDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (error) {
    console.warn(`[build] failed to clean ${nextDir}:`, error);
  }
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  if (attempt > 1) {
    cleanNextOutput();
    if (process.platform === "win32") {
      sleepMs(2000);
    }
  }

  const result = spawnSync(process.execPath, [nextCli, "build"], {
    cwd: webRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...(process.platform === "win32"
        ? {
            NEXT_DISABLE_WEBPACK_CACHE: "1",
            NEXT_TELEMETRY_DISABLED: "1"
          }
        : {})
    }
  });

  lastStatus = result.status ?? 1;
  if (lastStatus === 0) {
    process.exit(0);
  }

  if (attempt < maxAttempts) {
    console.warn(`[build] attempt ${attempt} failed; retrying after cleaning .next...`);
  }
}

process.exit(lastStatus);
