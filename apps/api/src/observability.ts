type TraceIdFactory = () => string;

const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export type HttpMetricFields = {
  metric_name: "http.server.request";
  metric_unit: "ms";
  metric_kind: "histogram";
  method: string;
  path: string;
  status: number;
  status_class: string;
  duration_ms: number;
};

export function normalizeTraceId(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }
  const candidate = input.trim();
  if (!TRACE_ID_PATTERN.test(candidate)) {
    return null;
  }
  return candidate;
}

export function createTraceId(input: string | null | undefined, createId: TraceIdFactory = () => crypto.randomUUID()): string {
  const normalized = normalizeTraceId(input);
  if (normalized) {
    return normalized;
  }
  return createId();
}

export function safePathname(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return "/";
  }
}

export function buildHttpMetricFields(args: {
  method: string;
  rawUrl: string;
  status: number;
  durationMs: number;
}): HttpMetricFields {
  const method = args.method.toUpperCase();
  const status = Number.isFinite(args.status) ? Math.trunc(args.status) : 500;
  const statusClass = `${Math.floor(status / 100)}xx`;
  const durationMs = Number.isFinite(args.durationMs) && args.durationMs >= 0 ? args.durationMs : 0;

  return {
    metric_name: "http.server.request",
    metric_unit: "ms",
    metric_kind: "histogram",
    method,
    path: safePathname(args.rawUrl),
    status,
    status_class: statusClass,
    duration_ms: durationMs
  };
}

type RequestMetricSample = {
  ts: number;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
};

type RouteMetricSummary = {
  path: string;
  request_count: number;
  error_count: number;
  error_rate: number;
  duration_ms: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
  };
};

export type HttpMetricsSummary = {
  generated_at: string;
  window: {
    sample_count: number;
    max_samples: number;
    oldest_ts: number | null;
    newest_ts: number | null;
  };
  totals: {
    request_count: number;
    error_count: number;
    error_rate: number;
    duration_ms: {
      min: number;
      max: number;
      avg: number;
      p50: number;
      p95: number;
    };
  };
  by_path: RouteMetricSummary[];
};

const MAX_REQUEST_METRIC_SAMPLES = 2000;
const requestMetricSamples: RequestMetricSample[] = [];

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function summarizeDurations(values: number[]) {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    min: values.reduce((min, value) => Math.min(min, value), values[0]),
    max: values.reduce((max, value) => Math.max(max, value), values[0]),
    avg: Number((total / values.length).toFixed(2)),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95)
  };
}

export function recordHttpRequestMetric(fields: HttpMetricFields): void {
  requestMetricSamples.push({
    ts: Date.now(),
    method: fields.method,
    path: fields.path,
    status: fields.status,
    duration_ms: fields.duration_ms
  });
  if (requestMetricSamples.length > MAX_REQUEST_METRIC_SAMPLES) {
    requestMetricSamples.splice(0, requestMetricSamples.length - MAX_REQUEST_METRIC_SAMPLES);
  }
}

export function buildHttpMetricsSummary(topPaths = 20): HttpMetricsSummary {
  const samples = requestMetricSamples;
  const durations = samples.map((sample) => sample.duration_ms);
  const errorCount = samples.filter((sample) => sample.status >= 500 || sample.status === 429).length;
  const requestCount = samples.length;

  const byPathMap = new Map<string, RequestMetricSample[]>();
  for (const sample of samples) {
    const bucket = byPathMap.get(sample.path) ?? [];
    bucket.push(sample);
    byPathMap.set(sample.path, bucket);
  }

  const byPath: RouteMetricSummary[] = [...byPathMap.entries()]
    .map(([path, rows]) => {
      const pathDurations = rows.map((row) => row.duration_ms);
      const pathErrors = rows.filter((row) => row.status >= 500 || row.status === 429).length;
      return {
        path,
        request_count: rows.length,
        error_count: pathErrors,
        error_rate: rows.length === 0 ? 0 : Number((pathErrors / rows.length).toFixed(4)),
        duration_ms: summarizeDurations(pathDurations)
      };
    })
    .sort((a, b) => b.request_count - a.request_count)
    .slice(0, topPaths);

  return {
    generated_at: new Date().toISOString(),
    window: {
      sample_count: requestCount,
      max_samples: MAX_REQUEST_METRIC_SAMPLES,
      oldest_ts: samples[0]?.ts ?? null,
      newest_ts: samples[samples.length - 1]?.ts ?? null
    },
    totals: {
      request_count: requestCount,
      error_count: errorCount,
      error_rate: requestCount === 0 ? 0 : Number((errorCount / requestCount).toFixed(4)),
      duration_ms: summarizeDurations(durations)
    },
    by_path: byPath
  };
}
