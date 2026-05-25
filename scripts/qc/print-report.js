#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const REPORT_PATH = path.join(ROOT_DIR, ".qc", "latest-report.json");

if (!fs.existsSync(REPORT_PATH)) {
  process.stderr.write("QC report not found. Run `pnpm qc:run` first.\n");
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
const summary = report.summary || {};

const lines = [
  "QC latest report summary",
  `generatedAt: ${report.generatedAt || "n/a"}`,
  `errors: ${summary.errors ?? 0}`,
  `bottlenecks: ${summary.bottlenecks ?? 0}`,
  `logicRisks: ${summary.logicRisks ?? 0}`,
  `passedChecks: ${summary.passedChecks ?? 0}`,
  `skippedChecks: ${summary.skippedChecks ?? 0}`,
  `totalFindings: ${summary.totalFindings ?? 0}`,
  `reportPath: ${path.relative(ROOT_DIR, REPORT_PATH).replace(/\\/g, "/")}`
];

process.stdout.write(`${lines.join("\n")}\n`);
