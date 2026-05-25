import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const source = join(webRoot, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const targetDir = join(webRoot, "public");
const target = join(targetDir, "pdf.worker.min.mjs");

if (!existsSync(source)) {
  console.warn(`[copy-pdf-worker] skip: source not found at ${source}`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`[copy-pdf-worker] copied worker to ${target}`);
