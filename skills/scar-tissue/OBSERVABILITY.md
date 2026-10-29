# Observability

An incident you cannot see lasts longer. These rules are about whether, at 3am, someone can tell what is broken, for whom, and since when. Report them only when the code is on a path where that question would actually be asked: money, data changes, external calls, background jobs. Do not report missing logging on trivial code.

## Contents

- observability.silent-failure
- observability.no-correlation-id
- observability.sensitive-data-logged
- observability.high-cardinality-labels
- observability.no-signal-on-critical-path

## observability.silent-failure

**Look for**: failure paths that produce no log, metric, or alert: retry exhaustion, dead-lettering, fallbacks taken, records skipped during a batch, background tasks and scheduled jobs that fail, webhooks rejected, reconciliation mismatches.

**Not a finding when**: the failure is surfaced to a caller who handles it, or it emits a structured error log plus a metric that is (or can be) alerted on.

**Failure**: a background job has been failing every night for a week. No dashboard changed and no alert fired, so nobody knew until customers complained. By then, a week of data needs to be repaired by hand.

**Fix**: every failure path that loses work or degrades behavior emits a signal someone will see: an error-level structured log with context (IDs, error type, attempt count; for example Python `logger.exception`, which includes the traceback) and a counter suitable for alerting (`jobs_failed_total`, `dlq_messages_total`, `fallback_used_total`). For scheduled jobs, also alert when a job has not succeeded within its expected interval (a dead man's switch), because a job that never starts produces no errors at all.

**Verify**: force each failure path in a test and assert the metric increments (or the log is emitted).

**Severity**: `medium`; `high` for jobs and consumers that move money or data.

## observability.no-correlation-id

**Look for**: requests and messages that cross service boundaries without a propagated request or trace ID, and logs that cannot be tied to a specific request: outbound HTTP calls without trace headers, queue messages without trace context, log lines without a request ID, async work that loses the context (thread pools in Java without MDC propagation, Python `contextvars` not carried into threads).

**Not a finding when**: OpenTelemetry or an equivalent instrumentation propagates context automatically for these clients and the logger includes the trace ID.

**Failure**: a customer reports a failed payment. Four services each logged thousands of lines in that minute, and nothing connects them. Diagnosis takes hours instead of minutes, during which the problem keeps happening.

**Fix**: accept or generate an ID at the edge, propagate it on every outbound call and message (W3C `traceparent`, OpenTelemetry context, or an `X-Request-ID` header), and include it in every log line through the logging context (MDC in Java, `contextvars`-based context in Python, `context.Context` with structured `slog` attributes in Go).

**Verify**: send a request through the path and confirm one ID appears in the logs of every service and worker it touches.

**Severity**: `medium`.

## observability.sensitive-data-logged

**Look for**: logging that can include secrets or personal data: full request or response bodies, headers (`Authorization`, `Cookie`, `Set-Cookie`, API keys), objects whose `toString()`/`repr()`/JSON form includes passwords, tokens, card numbers, bank details, government ID numbers, health data, or full addresses; exception messages that embed SQL with values; debug logging enabled in production configuration.

**Not a finding when**: logged payloads go through a redaction layer you can see, or only identifiers are logged.

**Failure**: secrets and personal data land in log storage, are copied to third-party log vendors, and are retained for months, readable by far more people than the production database. That is a security incident and a compliance problem (PCI DSS for card data; GDPR, India's DPDP Act, and similar laws for personal data) even if nothing else goes wrong.

**Fix**: log identifiers, not payloads. Redact known sensitive fields centrally in the logger or serializer. Exclude `Authorization` and cookie headers from request logging. Override `toString()`/`__repr__` on types that hold secrets. Rotate any credential that has been logged.

**Verify**: a test that logs a request containing a known fake secret and asserts it does not appear in the output.

**Severity**: `high`; `critical` for credentials and payment card data.

## observability.high-cardinality-labels

**Look for**: metric labels or tags taken from unbounded values: user ID, email, request ID, order ID, full URL path with IDs, raw error messages, IP addresses, query strings.

**Not a finding when**: the values come from a small, fixed set (route templates like `/orders/{id}`, status-code classes, error types, region, provider).

**Failure**: every distinct value creates a new time series. The metrics backend's memory and bill grow until it drops data or falls over, often taking down the dashboards you need during the incident that caused the spike.

**Fix**: keep labels to small fixed sets. Use the route template, not the raw path. Put per-request detail in logs and traces, not in metrics.

**Verify**: list the label values each metric can take and confirm the set is bounded.

**Severity**: `medium`; `high` when the label is per user or per request on a high-traffic path.

## observability.no-signal-on-critical-path

**Look for**: business-critical operations (payment, signup, login, order placement, payout, message send, critical job completion) with no metric for success, failure, and latency.

**Not a finding when**: these operations already emit success and failure counts and latency (directly or through instrumentation that captures the outcome, not only HTTP status).

**Failure**: payments start failing for one card network, one country, or one app version. Overall HTTP error rates barely move, so nothing alerts, and revenue drops silently for hours.

**Fix**: emit success and failure counters and a latency histogram for each critical operation, labeled with low-cardinality dimensions that matter (provider, method, region, failure reason category). Alert on the failure ratio and on volume dropping below normal.

**Verify**: force a failure in a test environment and confirm the metric changes and the alert condition triggers.

**Severity**: `medium`; `high` for payments and authentication.
