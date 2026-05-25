# Observability Stack (Cloudflare Workers)

Phase 1 scope: structured logs, in-process HTTP metrics, trace headers, and internal summary endpoint. External sinks (Logpush, Analytics Engine) are documented here for production rollout — no paid services required for local/dev.

Related code: `apps/api/src/observability.ts`, middleware in `apps/api/src/index.ts`.

## In-process metrics (shipped)

Every HTTP response records:

- `metric_name`: `http.server.request`
- `metric_kind`: `histogram`
- `metric_unit`: `ms`
- `method`, `path`, `status`, `status_class`, `duration_ms`

Trace headers:

- Request: optional `x-trace-id` (8–128 chars, `[A-Za-z0-9._:-]`)
- Response: `x-trace-id`, `x-request-duration-ms`

Structured logs include the same fields when `LOG_FORMAT=json` (default).

## Internal metrics summary endpoint

```http
GET /api/internal/metrics/summary?top_paths=20
Authorization: Bearer <INTERNAL_API_TOKEN>
```

Query params:

| Param | Default | Max | Description |
|---|---|---|---|
| `top_paths` | 20 | 100 | Number of routes in `top_paths` rollup |

Example (local Worker on `:8787`):

```bash
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  "http://127.0.0.1:8787/api/internal/metrics/summary?top_paths=10" | jq .
```

Response shape:

```json
{
  "ok": true,
  "metrics": {
    "window_started_at": 1716566400000,
    "sample_count": 42,
    "error_count": 1,
    "error_rate": 0.0238,
    "duration_ms": { "min": 1, "max": 890, "avg": 45.2, "p50": 12, "p95": 210 },
    "top_paths": [
      { "path": "/api/search", "request_count": 10, "error_count": 0, "error_rate": 0, "duration_ms": { "...": "..." } }
    ]
  },
  "pdf_circuit_breakers": []
}
```

Notes:

- Samples live in Worker memory (resets on isolate restart). Use Logpush / Analytics Engine for durable history.
- `pdf_circuit_breakers` mirrors in-memory per-DOI PDF proxy breaker state (max 25 rows).

## Cloudflare Workers Analytics Engine ($0 setup notes)

Analytics Engine stores custom event blobs from Workers. Enable when you need durable RED metrics without self-hosting.

1. Create a dataset in the Cloudflare dashboard (Workers & Pages -> Analytics Engine).
2. Uncomment the binding block in `apps/api/wrangler.toml` and set `dataset` to your dataset id.
3. In `recordHttpRequestMetric`, write the metric fields with `env.METRICS.writeDataPoint({ blobs: [...], doubles: [duration_ms], indexes: [path] })` (implement when binding is present).
4. Query via GraphQL Analytics API or Workers Analytics Engine SQL (dashboard).

Cost: Workers Paid plan includes AE usage; Free tier has no AE write binding — keep in-process summary for dev.

## Cloudflare Logpush ($0 setup notes)

Logpush ships Worker trace/log events to R2, S3, or a log vendor. Setup is dashboard-driven (not wrangler.toml).

1. Workers & Pages -> your Worker -> Logs -> Logpush -> Create.
2. Destination: R2 bucket (cheapest) or compatible S3 endpoint.
3. Filter: `Outcome != "ok"` for errors-only, or all events for full audit.
4. Parse JSON lines; fields include `Event`, `EventTimestamp`, `Outcome`, `ScriptName`, and any `console.log` JSON from structured logging.

Suggested R2 layout: `logs/worker/{yyyy}/{mm}/{dd}/`. Retention: 30 days (Lifecycle rule).

Alerting (optional, post-launch):

- Colab heartbeat: `POST /api/internal/heartbeat` missing > 30 min -> CF Notifications email (free). Check `colab_heartbeat.stale` in `GET /api/internal/metrics/summary`.
- Worker error rate > 1% (5 min) -> PagerDuty webhook from R2/Grafana Loki consumer.

## Colab heartbeat endpoint (shipped)

```http
POST /api/internal/heartbeat
Authorization: Bearer <INTERNAL_API_TOKEN>
Content-Type: application/json

{"run_id":"demo-001","processed":42,"last_doi":"10.1234/example","platform":"colab"}
```

```http
GET /api/internal/heartbeat
Authorization: Bearer <INTERNAL_API_TOKEN>
```

Response includes `stale: true` when last POST was more than 30 minutes ago. State is in-process (resets on Worker isolate restart); use Logpush for durable audit.

Unified DLQ + queue snapshot: `GET /api/internal/dlq/summary?recent_limit=10`.

## SLO targets (Phase 1)

| SLO | Target | Signal |
|---|---|---|
| API availability | 99.9% / month | Logpush 5xx rate |
| PDF proxy latency | P95 < 2s | `metrics.summary.duration_ms.p95` on `/api/pdf/proxy` |
| Cite precision | >= 0.92 rolling 30d | `eval/citation_benchmark` on real labels |

## Hot-path D1 LIMIT review (2026-05-24)

QC flags several `SELECT` heuristics in `apps/api/src/index.ts`. Review result:

- **No change required** for EXISTS subqueries (`paper_authors` / `paper_topics` filters), `COUNT(*)` aggregations scoped by `node_id`, or internal routes already paginated (`active-users`, `edges-to-revalidate`, `pending-bibs` with `LIMIT`).
- User-facing list endpoints (`/api/search`, `/api/feed`, `/api/collections`, `/api/papers/badges`) already enforce `LIMIT` via query params or `parseDoiList(max=50)`.
- GDPR delete (`DELETE /api/user/me`) scans `user_collections` by `user_id` — bounded by tier limits, acceptable for rare admin path.

Re-run QC after API changes: `node scripts/qc/run.js`.
