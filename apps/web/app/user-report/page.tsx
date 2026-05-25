import { readFile } from "node:fs/promises";
import path from "node:path";

type Persona = {
  id: string;
  label: string;
  primaryJobs: string[];
  topToolsToday: string[];
};

type FrictionPoint = {
  rank: number;
  id: string;
  issue: string;
  severity: string;
  personas: string[];
  userImpact: string;
  suggestedFix: string;
  linkedTodoId: string;
  source: string;
};

type UnmetWant = {
  rank: number;
  id: string;
  want: string;
  marketSignal: string;
  currentState: string;
  linkedTodoId: string;
};

type SprintItem = {
  priority: number;
  title: string;
  owner: string;
  linkedTodoId: string;
  rationale: string;
};

type UserReport = {
  generatedAt: string;
  methodology: {
    webResearchWindow: string;
    sources: string[];
    assumptions: string[];
  };
  summary: {
    totalFrictionPoints: number;
    totalUnmetWants: number;
    criticalGaps: number;
    codeMaturity: Record<string, string>;
  };
  personas: Persona[];
  frictionPoints: FrictionPoint[];
  unmetWants: UnmetWant[];
  recommendedNextSprint: {
    theme: string;
    durationWeeks: number;
    items: SprintItem[];
  };
};

export const dynamic = "force-dynamic";

const REPORT_PATH = path.resolve(process.cwd(), "..", "..", ".user-research", "latest-user-report.json");

async function loadReport(): Promise<UserReport | null> {
  try {
    const raw = await readFile(REPORT_PATH, "utf8");
    return JSON.parse(raw) as UserReport;
  } catch {
    return null;
  }
}

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`qc-severity qc-severity-${severity.toLowerCase()}`}>{severity}</span>;
}

export default async function UserReportPage() {
  const report = await loadReport();
  const topFriction = report?.frictionPoints.slice(0, 10) ?? [];
  const topWants = report?.unmetWants.slice(0, 10) ?? [];

  return (
    <main className="page-shell column">
      <header className="section-card column">
        <h1 style={{ margin: 0 }}>User Research Report</h1>
        {!report ? (
          <p className="muted-small">
            No user report found at <code>.user-research/latest-user-report.json</code>.
          </p>
        ) : (
          <p className="muted-small">
            Generated: {new Date(report.generatedAt).toLocaleString()} | Research window:{" "}
            {report.methodology.webResearchWindow} | Friction points: {report.summary.totalFrictionPoints} |
            Unmet wants: {report.summary.totalUnmetWants}
          </p>
        )}
      </header>

      {report ? (
        <>
          <section className="section-card column">
            <h2 style={{ margin: 0 }}>Overview</h2>
            <div className="qc-overview-grid">
              <div className="qc-overview-card">
                <strong>Critical gaps</strong>
                <span>{report.summary.criticalGaps}</span>
              </div>
              <div className="qc-overview-card">
                <strong>Friction points</strong>
                <span>{report.summary.totalFrictionPoints}</span>
              </div>
              <div className="qc-overview-card">
                <strong>Unmet wants</strong>
                <span>{report.summary.totalUnmetWants}</span>
              </div>
              <div className="qc-overview-card">
                <strong>Next sprint</strong>
                <span>{report.recommendedNextSprint.durationWeeks}w</span>
              </div>
            </div>
            <p className="muted-small">
              API: {report.summary.codeMaturity.api} | Web: {report.summary.codeMaturity.web} | Colab:{" "}
              {report.summary.codeMaturity.colab}
            </p>
          </section>

          <section className="section-card column">
            <h2 style={{ margin: 0 }}>Personas</h2>
            {report.personas.map((persona) => (
              <article key={persona.id} className="section-card">
                <strong>{persona.label}</strong>
                <p className="muted-small">Jobs: {persona.primaryJobs.join(", ")}</p>
                <p className="muted-small">Tools today: {persona.topToolsToday.join(", ")}</p>
              </article>
            ))}
          </section>

          <section className="section-card column">
            <h2 style={{ margin: 0 }}>Top 10 friction points</h2>
            {topFriction.map((item) => (
              <article key={item.id} className="qc-finding">
                <div className="qc-finding-head">
                  <strong>
                    #{item.rank} {item.issue}
                  </strong>
                  <SeverityBadge severity={item.severity} />
                </div>
                <p className="muted-small">
                  Personas: {item.personas.join(", ")} | source: {item.source} | todo:{" "}
                  <code>{item.linkedTodoId}</code>
                </p>
                <p className="muted-small">Impact: {item.userImpact}</p>
                <p className="muted-small">Fix: {item.suggestedFix}</p>
              </article>
            ))}
          </section>

          <section className="section-card column">
            <h2 style={{ margin: 0 }}>Top 10 unmet wants</h2>
            {topWants.map((item) => (
              <article key={item.id} className="qc-finding">
                <div className="qc-finding-head">
                  <strong>
                    #{item.rank} {item.want}
                  </strong>
                  <span className="qc-severity qc-severity-medium">{item.currentState}</span>
                </div>
                <p className="muted-small">
                  Market: {item.marketSignal} | todo: <code>{item.linkedTodoId}</code>
                </p>
              </article>
            ))}
          </section>

          <section className="section-card column">
            <h2 style={{ margin: 0 }}>Recommended next sprint: {report.recommendedNextSprint.theme}</h2>
            {report.recommendedNextSprint.items.map((item) => (
              <article key={item.priority} className="section-card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>
                    P{item.priority}: {item.title}
                  </strong>
                  <span className="muted-small">{item.owner}</span>
                </div>
                <p className="muted-small">
                  todo: <code>{item.linkedTodoId}</code>
                </p>
                <p className="muted-small">{item.rationale}</p>
              </article>
            ))}
          </section>

          <section className="section-card column">
            <h2 style={{ margin: 0 }}>Assumptions</h2>
            {report.methodology.assumptions.map((assumption, index) => (
              <p key={`assumption-${index}`} className="muted-small">
                {assumption}
              </p>
            ))}
          </section>
        </>
      ) : null}
    </main>
  );
}
