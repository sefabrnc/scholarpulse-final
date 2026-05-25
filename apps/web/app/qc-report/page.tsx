import { readFile } from "node:fs/promises";
import path from "node:path";

type Finding = {
  severity: string;
  file: string;
  line?: number | null;
  issue: string;
  suggestedFix: string;
  owner: string;
  workstream: string;
  linkedTodoId: string;
};

type Check = {
  name: string;
  status: string;
  details: string;
  command?: string | null;
};

type QcReport = {
  generatedAt: string;
  summary: {
    errors: number;
    bottlenecks: number;
    logicRisks: number;
    passedChecks: number;
    skippedChecks: number;
    totalFindings: number;
  };
  findings: {
    errors: Finding[];
    bottlenecks: Finding[];
    logicRisks: Finding[];
  };
  checks: Check[];
  passedChecks: Array<{ name: string; details: string }>;
};

export const dynamic = "force-dynamic";

const REPORT_PATH = path.resolve(process.cwd(), "..", "..", ".qc", "latest-report.json");

async function loadReport(): Promise<QcReport | null> {
  try {
    const raw = await readFile(REPORT_PATH, "utf8");
    return JSON.parse(raw) as QcReport;
  } catch {
    return null;
  }
}

function FindingsSection({ title, items }: { title: string; items: Finding[] }) {
  return (
    <section className="section-card column">
      <h2 style={{ margin: 0 }}>{title}</h2>
      {items.length === 0 ? <p className="muted-small">No findings in this category.</p> : null}
      {items.map((item, index) => (
        <article key={`${item.file}-${item.line ?? 0}-${index}`} className="qc-finding">
          <div className="qc-finding-head">
            <strong>{item.issue}</strong>
            <span className={`qc-severity qc-severity-${item.severity.toLowerCase()}`}>{item.severity}</span>
          </div>
          <p className="muted-small">
            <code>{item.file}</code>
            {item.line ? `:${item.line}` : ""} | owner: <strong>{item.owner}</strong> | workstream:{" "}
            <strong>{item.workstream}</strong> | todo: <code>{item.linkedTodoId}</code>
          </p>
          <p className="muted-small">Suggested fix: {item.suggestedFix}</p>
        </article>
      ))}
    </section>
  );
}

export default async function QcReportPage() {
  const report = await loadReport();

  return (
    <main className="page-shell column">
      <header className="section-card column">
        <h1 style={{ margin: 0 }}>Quality Control Report</h1>
        {!report ? (
          <p className="muted-small">
            No QC report found at <code>.qc/latest-report.json</code>. Run <code>pnpm qc:run</code> first.
          </p>
        ) : (
          <p className="muted-small">
            Generated: {new Date(report.generatedAt).toLocaleString()} | Findings: {report.summary.totalFindings} |
            Passed checks: {report.summary.passedChecks} | Skipped checks: {report.summary.skippedChecks}
          </p>
        )}
      </header>

      {report ? (
        <>
          <section className="section-card column">
            <h2 style={{ margin: 0 }}>Overview</h2>
            <div className="qc-overview-grid">
              <div className="qc-overview-card">
                <strong>Errors</strong>
                <span>{report.summary.errors}</span>
              </div>
              <div className="qc-overview-card">
                <strong>Bottlenecks</strong>
                <span>{report.summary.bottlenecks}</span>
              </div>
              <div className="qc-overview-card">
                <strong>Logic Risks</strong>
                <span>{report.summary.logicRisks}</span>
              </div>
              <div className="qc-overview-card">
                <strong>Passed Checks</strong>
                <span>{report.summary.passedChecks}</span>
              </div>
            </div>
          </section>

          <FindingsSection title="Errors" items={report.findings.errors} />
          <FindingsSection title="Bottlenecks" items={report.findings.bottlenecks} />
          <FindingsSection title="Logic Risks" items={report.findings.logicRisks} />

          <section className="section-card column">
            <h2 style={{ margin: 0 }}>Passed Checks</h2>
            {report.passedChecks.length === 0 ? (
              <p className="muted-small">No checks passed in this run.</p>
            ) : (
              report.passedChecks.map((check, index) => (
                <p key={`${check.name}-${index}`} className="muted-small">
                  <strong>{check.name}</strong>: {check.details}
                </p>
              ))
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
