# Resource limits

Every resource without a limit has one anyway: whatever breaks first, whether memory, file descriptors, connections, or a dependency's patience. Production input is larger, more frequent, and more hostile than test input.

## Contents

- limits.unbounded-input
- limits.load-all-into-memory
- limits.missing-rate-limit
- limits.pool-exhaustion
- limits.unbounded-queue
- limits.resource-leak

## limits.unbounded-input

**Look for**: request bodies, uploads, arrays, batch sizes, and query parameters with no maximum: bulk endpoints accepting a list of IDs, `?limit=` taken from the client unchecked, file uploads, free-form JSON stored as-is, regular expressions applied to unbounded user input.

**Not a finding when**: limits are enforced at the edge for this route (reverse proxy or gateway body-size limits, framework `max_request_size`/`client_max_body_size`) and in the handler for item counts, or the input is from a trusted internal source with a bounded size.

**Failure**: one client sends 500,000 IDs, a 2 GB upload, or `?limit=10000000`. The request consumes all memory or CPU on the instance, and every other request on that instance fails with it. Retries move the same payload to the next instance.

**Fix**: enforce explicit maximums: body size, array length, page size, upload size, string length. Clamp client-supplied limits to a server maximum. Reject oversized input with 413 or 422 and a clear message.

**Verify**: tests that submit input just over each limit and assert a fast 413/422, not a timeout or a 500.

**Severity**: `high` on public or multi-tenant endpoints; `medium` on internal ones.

## limits.load-all-into-memory

**Look for**: reading an entire file, response, or result set into memory before processing: `file.read()`, `response.json()` / `response.content` on large downloads, `Files.readAllBytes`, `list(queryset)`, `ResultSet` fully materialized, `io.ReadAll` on unbounded bodies, building a whole CSV or PDF export in a string.

**Not a finding when**: the size is bounded and small by construction.

**Failure**: works for typical data. The day a customer's export is 3 GB, the process is OOM-killed, the job is retried, and it is killed again, in a loop.

**Fix**: stream: iterate over lines or chunks, use streaming parsers, server-side cursors (`yield_per`, `iterator()`, JDBC fetch size), and write output incrementally. Apply `io.LimitReader` or equivalent where the size cannot be trusted.

**Verify**: run the path with input larger than the process's memory limit and assert it completes with bounded memory.

**Severity**: `high` when the size is user- or data-driven.

## limits.missing-rate-limit

**Look for**: public or expensive endpoints without rate limiting: login, signup, password reset, OTP/SMS/email sending, search, report generation, file conversion, and anything that calls a paid third-party API (SMS, email, LLMs, geocoding, payment lookups).

**Not a finding when**: rate limiting is applied for this route at the gateway, CDN, or middleware level, per user and per IP or tenant.

**Failure**: a script or a buggy client loops on the endpoint. SMS and LLM bills spike (they are billed per request), credentials are brute-forced, OTP endpoints are abused to send spam at your expense, or one tenant consumes all capacity.

**Fix**: rate limit per user, per IP, and per tenant, with stricter limits on endpoints that cost money or send messages. Return 429 with `Retry-After`. Add per-account daily caps on paid side effects.

**Verify**: a test that exceeds the limit and asserts 429 responses and no additional paid calls.

**Severity**: `high` for authentication and paid side effects; `medium` otherwise.

## limits.pool-exhaustion

**Look for**: connection and thread pools that are unbounded, oversized, or shared between fast and slow work:
- Go `database/sql`: `MaxOpenConns` defaults to 0 (unlimited), so a traffic spike can open more connections than the database allows.
- Pool size × number of instances exceeding the database's connection limit (PostgreSQL `max_connections` defaults to 100). For reference, HikariCP defaults to 10 connections, SQLAlchemy's `QueuePool` to 5 plus 10 overflow, and node-postgres `Pool` to 10.
- One HTTP client pool shared by a fast critical dependency and a slow optional one.
- Blocking I/O on an async event loop or reactive thread (Node.js `fs.readFileSync` in handlers, blocking JDBC in WebFlux, synchronous `requests` inside `async def` handlers).

**Not a finding when**: pool sizes are set deliberately, the total across instances fits the database limit with headroom (or a pooler such as PgBouncer is in front), and slow dependencies have separate pools.

**Failure**: a slow dependency holds every connection in the shared pool and unrelated fast requests queue behind it. Or autoscaling adds instances, total connections exceed the database limit, and the database refuses everyone, including the instances that were healthy.

**Fix**: size pools from the database's capacity divided across instances (leave headroom for migrations and admin access), cap open connections explicitly, use a connection pooler for many instances, separate pools (bulkheads) for dependencies with different latency, and move blocking calls off event loops.

**Verify**: a load test at the maximum instance count confirms total connections stay under the database limit and a slow dependency does not starve other endpoints.

**Severity**: `high`.

## limits.unbounded-queue

**Look for**: in-memory queues, buffers, channels, and executors with no capacity: `new LinkedBlockingQueue<>()` with no capacity (and therefore `Executors.newFixedThreadPool`, which uses one), `Executors.newCachedThreadPool()` under unbounded load, Python `queue.Queue()` with no `maxsize`, `asyncio.Queue()` with no `maxsize`, lists used as work buffers.

**Not a finding when**: producers are bounded by construction, or the queue has a capacity with an explicit overflow behavior.

**Failure**: when consumers fall behind, the queue grows until the process runs out of memory. Everything in it is lost when the process dies, and latency for queued work grows without bound in the meantime.

**Fix**: bound every queue and choose what happens when it is full: block the producer (backpressure), reject with an error, or shed low-priority work. Anything that must not be lost belongs in a durable queue, not in memory.

**Verify**: a test that produces faster than it consumes and asserts memory stays bounded and the overflow behavior happens.

**Severity**: `medium`; `high` when the queue holds work that must not be lost.

## limits.resource-leak

**Look for**: resources not released on every path, especially error paths:
- Go: `resp.Body` not closed after `http.Do` (the connection is not reused and leaks), `rows.Close()` missing after `db.Query`, goroutines blocked forever on a channel nobody reads, `time.Ticker` never stopped.
- Java: JDBC `Connection`/`Statement`/`ResultSet`, streams, and HTTP responses not in try-with-resources.
- Python: files, sockets, and database sessions opened without `with` (for example `SessionLocal()` never closed when an exception is raised), `requests` streaming responses never closed.
- Node.js: event listeners added per request and never removed, intervals never cleared, streams not destroyed on error.

**Not a finding when**: the resource is managed by a context manager, `defer`, try-with-resources, or a framework-managed scope (for example a request-scoped session dependency that closes after the request).

**Failure**: each leaked connection, file handle, or goroutine is small, so nothing fails in tests. In production, they accumulate until the pool is exhausted or the process hits its file-descriptor or memory limit, typically hours or days after a deploy, and a restart "fixes" it until it happens again.

**Fix**: acquire and release in one construct (`with`, `defer`, try-with-resources, `finally`) so error paths release too. In Go, always `defer resp.Body.Close()` after checking the error, and drain the body if you want connection reuse.

**Verify**: a test that exercises the error paths repeatedly and asserts open connections, file descriptors, or goroutines return to baseline (pool metrics, `runtime.NumGoroutine`, leak-detection tooling).

**Severity**: `high` for connections and pooled resources; `medium` otherwise.
