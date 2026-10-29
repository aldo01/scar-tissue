# Timeouts and retries

Most cascading outages start the same way: one dependency slows down, callers wait on it without a limit, their worker pools fill, and now they are slow too. Retries added without discipline turn a slow dependency into a dead one.

## Contents

- timeouts.missing
- timeouts.budget-mismatch
- retries.no-backoff
- retries.unbounded
- retries.non-idempotent
- retries.amplification
- retries.permanent-errors

## timeouts.missing

**Look for**: an outbound call (HTTP, RPC, database, cache, queue, SMTP, cloud SDK, raw socket) with no explicit timeout, using a client whose default is to wait forever or for minutes.

| Stack | Waits forever or very long by default | Sensible default (usually not a finding) |
| --- | --- | --- |
| Python | `requests.*` with no `timeout=` (and `requests.Session` has no default-timeout setting), `urllib.request.urlopen` without `timeout`, `aiohttp` (5-minute total default) | `httpx` (5 s) |
| Java | `java.net.http.HttpClient` without `HttpRequest.Builder.timeout()`, `HttpURLConnection` and `new RestTemplate()` with the default factory (connect and read timeouts 0 = infinite), JDBC statements without a query timeout, Spring `WebClient` without a response timeout | OkHttp (10 s connect/read/write) |
| Go | `http.Get`, `http.Post`, `http.DefaultClient`, `&http.Client{}` without `Timeout`; requests whose `context` has no deadline; `net.Dial` without a timeout; `database/sql` calls with `context.Background()` | — |
| Node.js | `fetch` without an `AbortSignal`, `axios` without `timeout` (default 0 = none), `http.request` without a timeout | — |
| gRPC (any language) | Calls without a deadline (gRPC sets none by default) | — |
| Databases | PostgreSQL `statement_timeout` defaults to 0 (disabled) | — |

**Not a finding when**:
- The timeout is set centrally: a shared client or factory, a Spring `RestTemplateBuilder`/`ClientHttpRequestFactory` bean, an HTTP client wrapper used everywhere, a database role or connection-string setting, a service mesh timeout that applies to this exact route. Search for these before reporting.
- The client's default is already bounded and reasonable for this dependency (see table).
- The code is a one-off script, local tool, or manual migration where a hang is noticed and killed by a person. Report as `low` at most.

**Failure**: the dependency stops responding without closing the connection (a common failure mode during overload, network partitions, and stuck deploys). Each request that touches it holds a worker, thread, or connection until the pool is exhausted. The service stops responding to everything, health checks fail, and the orchestrator restarts it in a loop while the real problem is elsewhere.

**Fix**: set a connect timeout and an overall request timeout on every client, once, at construction where possible:

```python
requests.post(url, json=body, timeout=(3, 10))             # (connect, read) seconds
```
```java
HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(10)) // plus HttpClient.newBuilder().connectTimeout(...)
```
```go
client := &http.Client{Timeout: 10 * time.Second}
ctx, cancel := context.WithTimeout(ctx, 10*time.Second); defer cancel()
```
```ts
await fetch(url, { signal: AbortSignal.timeout(10_000) });
```

Choose values from the dependency's real latency (roughly 2–3× its p99), not round numbers, and keep them shorter than the caller's own deadline (see `timeouts.budget-mismatch`).

**Verify**: point the client at a server that accepts connections but never responds (a stub that sleeps, or Toxiproxy with a `timeout` toxic) and assert the call fails within the configured time.

**Severity**: `high` on request paths and shared worker pools. `critical` if it can stall payments, checkout, or authentication for every user. `low` in manual scripts.

## timeouts.budget-mismatch

**Look for**: an inner timeout longer than the outer deadline that contains it. Examples: the load balancer or API gateway gives up after 5 s, but the handler waits up to 30 s on a database query; a job has a 60 s lease but its HTTP calls allow 120 s; a frontend waits 10 s for an API that retries a 10 s dependency three times.

**Not a finding when**: the outer deadline is propagated and enforced inside (Go `context` deadlines, gRPC deadline propagation, a `remaining time` check before each step), so inner work is cancelled when the caller gives up.

**Failure**: the caller has already timed out (and often retried) while the callee keeps working on a request nobody is waiting for. Work is duplicated exactly when the system is overloaded, which deepens the overload.

**Fix**: make inner timeouts strictly shorter than outer ones, accounting for retries (total inner time = attempts × per-attempt timeout + backoff). Propagate the deadline downstream (gRPC deadlines, Go `context`, a deadline header) and stop work once it passes.

**Verify**: sum the worst-case inner time along the path and compare it with each outer deadline. Add a test that cancels the caller and asserts downstream work stops.

**Severity**: `medium`; `high` when the wasted work lands on an already-scarce resource (database, payment provider).

## retries.no-backoff

**Look for**: a retry loop that retries immediately or after a fixed delay with no jitter. Also check library defaults:

| Library | Default behavior |
| --- | --- |
| Python `tenacity` | `@retry` with no arguments retries **forever with no wait** |
| `axios-retry` | 3 retries with **no delay** |
| Spring Retry `@Retryable` | 3 attempts, fixed 1 s delay, no jitter |
| Resilience4j Retry | 3 attempts, fixed 500 ms wait unless an interval function is configured |

**Not a finding when**: backoff is exponential with jitter (for example `wait_random_exponential` in tenacity, `ExponentialRandomBackoffPolicy` in Spring Retry, `IntervalFunction.ofExponentialRandomBackoff` in Resilience4j), or the loop runs at most once and only in an offline tool.

**Failure**: when a dependency blips, every client retries at the same instant. The synchronized waves keep the dependency overloaded after it would otherwise have recovered (a retry storm), extending a 30-second blip into a multi-minute outage.

**Fix**: exponential backoff with full jitter, capped, and honor `Retry-After` on 429 and 503:

```python
delay = random.uniform(0, min(cap, base * 2 ** attempt))   # base ≈ 0.1–0.5 s, cap ≈ 2–10 s
```

**Verify**: unit-test the delay function across attempts (bounded, increasing on average, randomized). Check that `Retry-After` overrides it.

**Severity**: `high` for clients with many instances calling a shared dependency; `medium` for a single low-volume worker.

## retries.unbounded

**Look for**: `while True` retry loops, "retry until success", `tenacity` without `stop=`, Kafka consumers that rethrow the same message indefinitely, jobs re-enqueued on every failure with no attempt counter.

**Not a finding when**: there is a cap on attempts or on total elapsed time, after which the failure is surfaced (raised, dead-lettered, or alerted).

**Failure**: a permanent error (revoked credentials, deleted resource, malformed payload) keeps a worker busy forever. In a queue consumer, every message behind it stalls; consumer lag grows without bound and the incident is noticed hours later as "nothing is being processed".

**Fix**: cap attempts (3–5 is typical) and total time. After the cap, fail loudly: raise to the caller, move the message to a dead-letter queue, or record the failure where it will be alerted on.

**Verify**: a test where the dependency always fails asserts that the call gives up after the cap and surfaces the error.

**Severity**: `high` in consumers and workers; `medium` on request paths with an outer timeout.

## retries.non-idempotent

**Look for**: automatic retries around an operation with a side effect that is not deduplicated: a POST that creates, charges, refunds, transfers, sends, or publishes; a gRPC unary call that mutates; a retry decorator on a service method that writes and then calls out.

**Not a finding when**:
- The operation is naturally idempotent (PUT replacing a whole resource, setting a status to a fixed value, an upsert on a natural key).
- An idempotency key that stays the same across attempts is sent and enforced by the receiver (see `idempotency.missing-key`, `idempotency.unstable-key`).
- The library only retries safe methods. For example, urllib3 `Retry` does not retry POST by default, and `axios-retry` by default retries only network errors and idempotent methods.

**Failure**: the first attempt actually succeeds, but the response is lost (timeout, connection reset, process restart). The retry repeats the side effect: two charges, two emails, two orders, two transfers.

**Fix**: send a stable idempotency key on every attempt and confirm the receiver honors it (many payment APIs do, for example Stripe's `Idempotency-Key` header and PayPal's `PayPal-Request-Id`). If the receiver cannot deduplicate, do not retry automatically; record the uncertain outcome and reconcile it.

**Verify**: a test where the first attempt succeeds on the server but the client sees a timeout, then asserts the side effect happened exactly once.

**Severity**: `critical` when money or customer-facing messages are involved; `high` otherwise.

## retries.amplification

**Look for**: retries at more than one layer for the same call. Typical stacks: an SDK with built-in retries (AWS SDKs retry by default, typically 3 attempts; Google Cloud client libraries and many HTTP clients also retry), wrapped in an application retry decorator, called from a job or queue consumer that retries the whole unit, behind a client that retries the API.

**Not a finding when**: only one layer retries, or the outer layers retry only on failures the inner layers do not retry, or there is a retry budget.

**Failure**: the multipliers compound. Three layers of three attempts turn one failing request into 27 calls against the struggling dependency, plus everything queued behind them.

**Fix**: retry at exactly one layer, usually the one closest to the failing call. Disable or reduce SDK retries if the application retries, or the reverse. For high-traffic clients, cap retries as a fraction of normal traffic (a retry budget, for example at most 10% extra).

**Verify**: list every retry layer on the path and multiply the attempt counts. The product should be small (ideally the attempts of a single layer).

**Severity**: `medium`; `high` if the dependency is shared by many services.

## retries.permanent-errors

**Look for**: catch-all retries that include errors that will never succeed on retry: HTTP 400, 401, 403, 404, 409, 422; validation errors; "card declined"; deserialization failures. A common trap: in Python, `requests.HTTPError` (raised by `raise_for_status()`) is a subclass of `requests.RequestException`, so `except requests.RequestException` retries every 4xx.

**Not a finding when**: the retry condition is limited to transient failures (connection errors, timeouts, 429, 502, 503, 504, and errors the provider documents as retryable).

**Failure**: wasted capacity and slower failures for users. Retrying 401s can lock accounts or trip rate limits; retrying declined payments can trigger the card issuer's fraud checks.

**Fix**: retry only transient failures. Return permanent errors to the caller immediately with an accurate status.

**Verify**: tests asserting a 4xx response is attempted exactly once and a 503 is retried.

**Severity**: `low` in general; `medium` when retries hit payment, authentication, or rate-limited third-party APIs.
