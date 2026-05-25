import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const tsbuildinfo = join(webRoot, "tsconfig.tsbuildinfo");
const nextDir = join(webRoot, ".next");
const source = join(webRoot, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const targetDir = join(webRoot, "public");
const target = join(targetDir, "pdf.worker.min.mjs");

if (process.env.SP_PREBUILD_CLEAN_NEXT === "1" && existsSync(nextDir)) {
  rmSync(nextDir, { recursive: true, force: true });
  console.log("[prebuild] removed stale .next (SP_PREBUILD_CLEAN_NEXT=1)");
}

if (existsSync(tsbuildinfo)) {
  rmSync(tsbuildinfo, { force: true });
}

if (!existsSync(source)) {
  console.warn(`[prebuild] skip pdf worker copy: source not found at ${source}`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`[prebuild] copied pdf worker to ${target}`);
