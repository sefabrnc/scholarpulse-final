#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const QC_DIR = path.join(ROOT_DIR, ".qc");
const REPORT_PATH = path.join(QC_DIR, "latest-report.json");
const OWNERSHIP_PATH = path.join(QC_DIR, "ownership-map.json");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IS_WIN = process.platform === "win32";

function runCommand(command, args, options = {}) {
  const spawnOptions = {
    cwd: ROOT_DIR,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
    shell: false,
    ...options
  };
  const result = spawnSync(command, args, spawnOptions);
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null
  };
}

function isCommandMissing(result) {
  if (result.error && result.error.code === "ENOENT") {
    return true;
  }
  if (result.status === null && !result.stdout && !result.stderr) {
    return true;
  }
  const stderr = `${result.stderr || ""}`.toLowerCase();
  if (
    result.status === 255 ||
    result.status === 1 ||
    /not recognized|command not found|enoent/.test(stderr)
  ) {
    return /not recognized|command not found|enoent|'rg'/.test(stderr);
  }
  return false;
}

function normalizePath(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.replace(/^\.?\//, "");
}

function readJson(filePath, fallbackValue) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

function loadWorkspacePackage(relativeDir) {
  const pkgPath = path.join(ROOT_DIR, relativeDir, "package.json");
  const pkg = readJson(pkgPath, null);
  if (!pkg) {
    return null;
  }
  return { pkgPath, pkg };
}

function createEmptyReport() {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      errors: 0,
      bottlenecks: 0,
      logicRisks: 0,
      passedChecks: 0,
      skippedChecks: 0,
      totalFindings: 0
    },
    checks: [],
    findings: {
      errors: [],
      bottlenecks: [],
      logicRisks: []
    },
    passedChecks: []
  };
}

function loadOwnershipMap() {
  return readJson(OWNERSHIP_PATH, {
    defaultTodoId: "quality-control-work",
    todos: {
      "quality-control-work": {
        owner: "quality-control",
        workstream: "quality-control"
      }
    },
    rules: []
  });
}

function resolveOwnership(ownershipMap, filePath, category) {
  const rules = Array.isArray(ownershipMap.rules) ? ownershipMap.rules : [];
  const normalizedFilePath = normalizePath(filePath || "");

  let selectedTodoId = null;

  for (const rule of rules) {
    const pathMatches =
      !rule.pathPrefix || normalizedFilePath.startsWith(normalizePath(rule.pathPrefix));
    const categoryMatches = !rule.category || rule.category === category;
    if (pathMatches && categoryMatches) {
      selectedTodoId = rule.todoId;
      break;
    }
  }

  if (!selectedTodoId) {
    selectedTodoId = ownershipMap.defaultTodoId || "quality-control-work";
  }

  const todo = (ownershipMap.todos && ownershipMap.todos[selectedTodoId]) || {};
  return {
    linkedTodoId: selectedTodoId,
    owner: todo.owner || "quality-control",
    workstream: todo.workstream || "quality-control"
  };
}

function addFinding(report, ownershipMap, category, finding) {
  const ownership = resolveOwnership(ownershipMap, finding.file, category);
  const enriched = {
    severity: finding.severity,
    file: normalizePath(finding.file || "n/a"),
    line: finding.line || null,
    issue: finding.issue,
    suggestedFix: finding.suggestedFix,
    owner: ownership.owner,
    workstream: ownership.workstream,
    linkedTodoId: ownership.linkedTodoId
  };

  if (category === "Errors") {
    report.findings.errors.push(enriched);
  } else if (category === "Bottlenecks") {
    report.findings.bottlenecks.push(enriched);
  } else {
    report.findings.logicRisks.push(enriched);
  }
}

function addCheck(report, check) {
  report.checks.push(check);
  if (check.status === "passed") {
    report.passedChecks.push({
      name: check.name,
      details: check.details
    });
  }
}

function runWorkspaceScriptChecks(report, ownershipMap) {
  const targets = [
    { dir: "apps/api", label: "apps/api" },
    { dir: "apps/web", label: "apps/web" }
  ];
  const scriptNames = ["typecheck", "build", "lint", "test"];

  for (const target of targets) {
    const loaded = loadWorkspacePackage(target.dir);
    if (!loaded) {
      addCheck(report, {
        name: `${target.label}:package`,
        status: "failed",
        details: "package.json is missing",
        command: null
      });
      addFinding(report, ownershipMap, "Errors", {
        severity: "high",
        file: path.join(target.dir, "package.json"),
        issue: "Workspace package metadata not found",
        suggestedFix: "Restore package.json before running quality checks."
      });
      continue;
    }

    const packageName = loaded.pkg.name;
    const scripts = loaded.pkg.scripts || {};

    for (const scriptName of scriptNames) {
      const checkName = `${target.label}:${scriptName}`;
      if (!scripts[scriptName]) {
        addCheck(report, {
          name: checkName,
          status: "skipped",
          details: "Script is not configured in package.json",
          command: null
        });
        continue;
      }

      const commandLabel = `corepack pnpm --filter ${packageName} ${scriptName}`;
      const result = runCommand("corepack", ["pnpm", "--filter", packageName, scriptName], {
        shell: IS_WIN
      });
      if (result.ok) {
        addCheck(report, {
          name: checkName,
          status: "passed",
          details: "Command completed without errors",
          command: commandLabel
        });
      } else {
        addCheck(report, {
          name: checkName,
          status: "failed",
          details: `Command exited with code ${result.status}`,
          command: commandLabel
        });
        const failureBody = [result.stdout, result.stderr].join("\n").trim();
        addFinding(report, ownershipMap, "Errors", {
          severity: "high",
          file: path.join(target.dir, "package.json"),
          issue: `${checkName} failed`,
          suggestedFix: `Fix failing command output: ${failureBody.slice(0, 280) || "No diagnostics available."}`
        });
      }
    }
  }
}

const QC_PATTERN_SKIP_PREFIXES = {
  "fallback-only": [
    "apps/web/app/api/public/",
    "apps/web/lib/public/",
    "apps/web/app/authors/",
    "apps/web/app/cite/",
    "apps/web/app/paper/",
    "apps/web/app/timeline/",
    "apps/web/app/topics/"
  ],
  "uncaught-promise": ["apps/web/components/timeline/TimelineSnippetPreview.tsx"]
};

function shouldSkipPatternFinding(patternKey, filePath) {
  const prefixes = QC_PATTERN_SKIP_PREFIXES[patternKey];
  if (!prefixes) {
    return false;
  }
  const normalized = normalizePath(filePath || "");
  return prefixes.some((prefix) => normalized.startsWith(normalizePath(prefix)));
}

function parseRgOutput(
  stdout,
  category,
  defaultSeverity,
  issueText,
  suggestedFix,
  report,
  ownershipMap,
  patternKey
) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const firstColon = line.indexOf(":");
    const secondColon = line.indexOf(":", firstColon + 1);
    if (firstColon < 0 || secondColon < 0) {
      continue;
    }

    const file = line.slice(0, firstColon);
    if (shouldSkipPatternFinding(patternKey, file)) {
      continue;
    }
    const lineNumber = Number(line.slice(firstColon + 1, secondColon));
    addFinding(report, ownershipMap, category, {
      severity: defaultSeverity,
      file,
      line: Number.isFinite(lineNumber) ? lineNumber : null,
      issue: issueText,
      suggestedFix
    });
  }
}

function searchSourceWithNodeRegex(pattern) {
  const regex = new RegExp(pattern);
  const matches = [];
  const files = listSourceFiles();

  for (const absoluteFilePath of files) {
    const relativeFilePath = normalizePath(path.relative(ROOT_DIR, absoluteFilePath));
    const raw = fs.readFileSync(absoluteFilePath, "utf8");
    const lines = raw.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      if (regex.test(lines[index])) {
        matches.push(`${relativeFilePath}:${index + 1}:${lines[index]}`);
      }
    }
  }

  return matches.join("\n");
}

function runRipgrepSearch(pattern, searchRoots) {
  const args = [
    "--line-number",
    "--no-heading",
    "--glob",
    "!**/node_modules/**",
    "--glob",
    "!**/.next/**",
    "--glob",
    "!**/dist/**",
    pattern,
    ...searchRoots
  ];
  const result = runCommand("rg", args, { shell: false });
  if (isCommandMissing(result)) {
    const stdout = searchSourceWithNodeRegex(pattern);
    return {
      ok: true,
      status: stdout ? 0 : 1,
      stdout,
      stderr: "",
      usedFallback: true
    };
  }
  return { ...result, usedFallback: false };
}

function runRiskPatternChecks(report, ownershipMap) {
  const patterns = [
    {
      key: "explicit-any",
      pattern: "\\bany\\b|as\\s+any",
      category: "Logic Risks",
      severity: "medium",
      issue: "Potentially unsafe any typing usage",
      suggestedFix: "Replace any with a narrow type or generic constraint."
    },
    {
      key: "todo-fixme",
      pattern: "TODO|FIXME",
      category: "Logic Risks",
      severity: "low",
      issue: "Pending TODO/FIXME marker found",
      suggestedFix: "Track this as an explicit task or resolve before release."
    },
    {
      key: "empty-catch",
      pattern: "catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}",
      category: "Errors",
      severity: "high",
      issue: "Empty catch block can hide runtime failures",
      suggestedFix: "Log or rethrow the error with context."
    },
    {
      key: "fallback-only",
      pattern: "\\|\\|\\s*(\\{\\}|\\[\\]|''|\"\"|0|false)",
      category: "Logic Risks",
      severity: "medium",
      issue: "Fallback-only branch may mask invalid state",
      suggestedFix: "Validate upstream state before defaulting to fallback values."
    },
    {
      key: "uncaught-promise",
      pattern: "void\\s+[^;]+\\(",
      category: "Errors",
      severity: "medium",
      issue: "Fire-and-forget async call may lose failures",
      suggestedFix: "Handle promise rejection explicitly or document non-critical behavior."
    }
  ];

  for (const patternDef of patterns) {
    const result = runRipgrepSearch(patternDef.pattern, ["apps/api", "apps/web"]);
    if (result.status !== 0 && result.status !== 1) {
      addCheck(report, {
        name: `static:${patternDef.key}`,
        status: "failed",
        details: `Pattern scan failed with code ${result.status}`,
        command: `rg ${patternDef.pattern} apps/api apps/web`
      });
      continue;
    }

    const scanDetails =
      result.status === 1
        ? "No matches found"
        : result.usedFallback
          ? "Matches detected via Node regex fallback"
          : "Matches detected and added to report";

    addCheck(report, {
      name: `static:${patternDef.key}`,
      status: "passed",
      details: scanDetails,
      command: result.usedFallback
        ? `node-regex ${patternDef.pattern} apps/api apps/web`
        : `rg ${patternDef.pattern} apps/api apps/web`
    });

    if (result.status === 0) {
      parseRgOutput(
        result.stdout,
        patternDef.category,
        patternDef.severity,
        patternDef.issue,
        patternDef.suggestedFix,
        report,
        ownershipMap,
        patternDef.key
      );
    }
  }
}

function listSourceFiles() {
  const collected = [];

  function walk(currentPath) {
    const stat = fs.statSync(currentPath);
    if (stat.isDirectory()) {
      const baseName = path.basename(currentPath);
      if (baseName === "node_modules" || baseName === ".next" || baseName === "dist" || baseName === "public") {
        return;
      }
      const entries = fs.readdirSync(currentPath);
      for (const entry of entries) {
        walk(path.join(currentPath, entry));
      }
      return;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(currentPath))) {
      collected.push(currentPath);
    }
  }

  walk(path.join(ROOT_DIR, "apps", "api"));
  walk(path.join(ROOT_DIR, "apps", "web"));
  return collected;
}

function runPerformanceHeuristics(report, ownershipMap) {
  const files = listSourceFiles();

  for (const absoluteFilePath of files) {
    const relativeFilePath = normalizePath(path.relative(ROOT_DIR, absoluteFilePath));
    const raw = fs.readFileSync(absoluteFilePath, "utf8");
    const lines = raw.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const lineNumber = index + 1;

      if (/for\s*\(\s*;\s*;\s*\)|while\s*\(\s*true\s*\)/.test(line)) {
        addFinding(report, ownershipMap, "Bottlenecks", {
          severity: "high",
          file: relativeFilePath,
          line: lineNumber,
          issue: "Potentially unbounded loop detected",
          suggestedFix: "Add explicit break criteria or bounded iteration."
        });
      }

      if (/db\.prepare\s*\(\s*`/i.test(line) || /SELECT\s+/i.test(line)) {
        const queryWindow = lines.slice(index, index + 8).join(" ");
        const hasSelect = /SELECT\s+/i.test(queryWindow);
        const hasLimit = /\bLIMIT\b/i.test(queryWindow);
        if (hasSelect && !hasLimit) {
          addFinding(report, ownershipMap, "Bottlenecks", {
            severity: "medium",
            file: relativeFilePath,
            line: lineNumber,
            issue: "Potential unbounded query without LIMIT heuristic",
            suggestedFix: "Add LIMIT/pagination or explain why full scan is acceptable."
          });
        }
      }

      if (/\.map\(/.test(line)) {
        const nestedWindow = lines.slice(index, index + 6).join(" ");
        const nestedCount = (nestedWindow.match(/\.map\(/g) || []).length;
        if (nestedCount >= 2) {
          addFinding(report, ownershipMap, "Bottlenecks", {
            severity: "low",
            file: relativeFilePath,
            line: lineNumber,
            issue: "Nested map operations may increase render/computation cost",
            suggestedFix: "Flatten loops or memoize expensive transformations."
          });
        }
      }
    }
  }

  addCheck(report, {
    name: "heuristic:performance",
    status: "passed",
    details: `Scanned ${files.length} source files for bottleneck signals`,
    command: null
  });
}

function finalizeSummary(report) {
  report.summary.errors = report.findings.errors.length;
  report.summary.bottlenecks = report.findings.bottlenecks.length;
  report.summary.logicRisks = report.findings.logicRisks.length;
  report.summary.passedChecks = report.checks.filter((check) => check.status === "passed").length;
  report.summary.skippedChecks = report.checks.filter((check) => check.status === "skipped").length;
  report.summary.totalFindings =
    report.summary.errors + report.summary.bottlenecks + report.summary.logicRisks;
}

function writeReport(report) {
  fs.mkdirSync(QC_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function printSummary(report) {
  const lines = [
    "QC report generated.",
    `- Output: ${normalizePath(path.relative(ROOT_DIR, REPORT_PATH))}`,
    `- Errors: ${report.summary.errors}`,
    `- Bottlenecks: ${report.summary.bottlenecks}`,
    `- Logic Risks: ${report.summary.logicRisks}`,
    `- Passed Checks: ${report.summary.passedChecks}`,
    `- Skipped Checks: ${report.summary.skippedChecks}`
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function main() {
  const report = createEmptyReport();
  const ownershipMap = loadOwnershipMap();

  runWorkspaceScriptChecks(report, ownershipMap);
  runRiskPatternChecks(report, ownershipMap);
  runPerformanceHeuristics(report, ownershipMap);
  finalizeSummary(report);
  writeReport(report);
  printSummary(report);
}

main();
