"use client";

import { useState } from "react";
import { apiPost } from "../../lib/api/client";

type TimelineReportButtonProps = {
  edgeId: string;
};

export function TimelineReportButton(props: TimelineReportButtonProps) {
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleReport = async () => {
    if (!window.confirm("Report this citation link as incorrect?")) {
      return;
    }
    setStatus("busy");
    setMessage("");
    try {
      const response = await apiPost<{
        ok?: boolean;
        duplicate?: boolean;
        flagged_count?: number;
      }>(`/api/cite/edges/${encodeURIComponent(props.edgeId)}/report`, {
        flag_code: "wrong_citation",
        reason_code: "timeline_report"
      });
      if (response.duplicate) {
        setMessage("Already reported.");
      } else {
        setMessage("Report submitted.");
      }
      setStatus("done");
    } catch (cause) {
      setStatus("error");
      setMessage(cause instanceof Error ? cause.message : "Report failed");
    }
  };

  return (
    <div className="timeline-report-wrap">
      <button type="button" className="timeline-report-btn" onClick={handleReport} disabled={status === "busy"}>
        {status === "busy" ? "Reporting..." : "Report incorrect"}
      </button>
      {message ? <span className="muted-small">{message}</span> : null}
    </div>
  );
}
