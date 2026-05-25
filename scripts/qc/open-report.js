#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const REPORT_PATH = path.join(ROOT_DIR, ".qc", "latest-report.json");
const TARGET_URL = "http://localhost:3000/qc-report";

if (!fs.existsSync(REPORT_PATH)) {
  process.stderr.write("QC report not found. Run `pnpm qc:run` first.\n");
  process.exit(1);
}

const reportRelativePath = path.relative(ROOT_DIR, REPORT_PATH).replace(/\\/g, "/");
process.stdout.write(`QC report file: ${reportRelativePath}\n`);
process.stdout.write(`Open this page in the web app: ${TARGET_URL}\n`);

if (process.platform === "win32") {
  spawnSync("cmd", ["/c", "start", TARGET_URL], {
    cwd: ROOT_DIR,
    stdio: "ignore"
  });
}
