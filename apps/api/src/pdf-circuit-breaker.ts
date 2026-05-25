export type CircuitBreakerState = "closed" | "open" | "half_open";

export type CircuitBreakerSnapshot = {
  state: CircuitBreakerState;
  consecutive_failures: number;
  opened_at: number | null;
  retry_after_sec: number | null;
};

type CircuitEntry = {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  openedAtMs: number | null;
  halfOpenInFlight: boolean;
};

const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 30 * 60 * 1000;

const circuits = new Map<string, CircuitEntry>();

function getOrCreateEntry(key: string): CircuitEntry {
  const existing = circuits.get(key);
  if (existing) {
    return existing;
  }
  const created: CircuitEntry = {
    state: "closed",
    consecutiveFailures: 0,
    openedAtMs: null,
    halfOpenInFlight: false
  };
  circuits.set(key, created);
  return created;
}

function transitionToOpen(entry: CircuitEntry, now: number) {
  entry.state = "open";
  entry.openedAtMs = now;
  entry.halfOpenInFlight = false;
}

function transitionToClosed(entry: CircuitEntry) {
  entry.state = "closed";
  entry.consecutiveFailures = 0;
  entry.openedAtMs = null;
  entry.halfOpenInFlight = false;
}

function maybeAdvanceOpenToHalfOpen(entry: CircuitEntry, now: number) {
  if (entry.state !== "open" || entry.openedAtMs === null) {
    return;
  }
  if (now - entry.openedAtMs >= OPEN_DURATION_MS) {
    entry.state = "half_open";
    entry.halfOpenInFlight = false;
  }
}

export function getPdfCircuitBreakerSnapshot(key: string): CircuitBreakerSnapshot {
  const now = Date.now();
  const entry = getOrCreateEntry(key);
  maybeAdvanceOpenToHalfOpen(entry, now);

  if (entry.state === "open" && entry.openedAtMs !== null) {
    const retryAfterMs = entry.openedAtMs + OPEN_DURATION_MS - now;
    return {
      state: "open",
      consecutive_failures: entry.consecutiveFailures,
      opened_at: entry.openedAtMs,
      retry_after_sec: Math.max(1, Math.ceil(retryAfterMs / 1000))
    };
  }

  return {
    state: entry.state,
    consecutive_failures: entry.consecutiveFailures,
    opened_at: entry.openedAtMs,
    retry_after_sec: null
  };
}

export function allowPdfCircuitRequest(key: string): { allowed: true } | { allowed: false; retryAfterSec: number; state: CircuitBreakerState } {
  const now = Date.now();
  const entry = getOrCreateEntry(key);
  maybeAdvanceOpenToHalfOpen(entry, now);

  if (entry.state === "open" && entry.openedAtMs !== null) {
    const retryAfterMs = entry.openedAtMs + OPEN_DURATION_MS - now;
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      state: "open"
    };
  }

  if (entry.state === "half_open") {
    if (entry.halfOpenInFlight) {
      const retryAfterSec = 5;
      return { allowed: false, retryAfterSec, state: "half_open" };
    }
    entry.halfOpenInFlight = true;
  }

  return { allowed: true };
}

export function recordPdfCircuitSuccess(key: string) {
  const entry = getOrCreateEntry(key);
  transitionToClosed(entry);
}

export function recordPdfCircuitFailure(key: string) {
  const now = Date.now();
  const entry = getOrCreateEntry(key);

  if (entry.state === "half_open") {
    entry.consecutiveFailures += 1;
    transitionToOpen(entry, now);
    return;
  }

  entry.consecutiveFailures += 1;
  if (entry.consecutiveFailures >= FAILURE_THRESHOLD) {
    transitionToOpen(entry, now);
  }
}

export function listPdfCircuitBreakerSnapshots(limit = 50): Array<{ key: string } & CircuitBreakerSnapshot> {
  const now = Date.now();
  const rows: Array<{ key: string } & CircuitBreakerSnapshot> = [];
  for (const [key, entry] of circuits.entries()) {
    maybeAdvanceOpenToHalfOpen(entry, now);
    rows.push({ key, ...getPdfCircuitBreakerSnapshot(key) });
  }
  rows.sort((a, b) => {
    const rank = (state: CircuitBreakerState) => (state === "open" ? 0 : state === "half_open" ? 1 : 2);
    const diff = rank(a.state) - rank(b.state);
    if (diff !== 0) {
      return diff;
    }
    return b.consecutive_failures - a.consecutive_failures;
  });
  return rows.slice(0, limit);
}
