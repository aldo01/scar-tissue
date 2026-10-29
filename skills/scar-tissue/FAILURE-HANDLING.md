# Failure handling

Happy paths get tested. Failure paths usually run for the first time in production, at the worst moment. These rules cover what code does when something goes wrong.

## Contents

- failure.swallowed-error
- failure.partial-failure
- failure.unsafe-fallback
- failure.no-circuit-breaker
- failure.no-graceful-shutdown
- failure.deep-health-check

## failure.swallowed-error

**Look for**: errors caught and ignored, or caught and logged without changing the outcome:

```python
try:
    send_invoice(order)
except Exception:
    pass
```
```go
result, _ := chargeCard(ctx, req)     // error discarded
```
```ts
promise.catch(() => {});              // or an unawaited promise whose rejection nobody handles
```

Also: returning `200 OK` after an internal failure, returning `null` or an empty list where an error occurred, Java `catch (Exception e) { log.error(...) }` that continues as if the step succeeded, and fire-and-forget tasks whose failures are never observed.

**Not a finding when**: the error is expected and harmless here, and the code says so (for example ignoring "already exists" on an idempotent create), or the failure is recorded where someone will see it (metric, alert, dead-letter, retry table) and the caller gets an accurate result.

**Failure**: the operation fails and every signal says it succeeded. Invoices are never sent, records are silently skipped, data is half-written, and the problem is found weeks later by a customer or an auditor.

**Fix**: catch only the errors you can handle, and let the rest propagate. If processing must continue, record the failure durably and visibly (a metric to alert on, a dead-letter entry, a retry table) and return an accurate status.

**Verify**: a test that forces the dependency to fail and asserts the caller sees the failure (or that the failure is recorded for retry).

**Severity**: `high` when work or data is silently lost; `medium` otherwise.

## failure.partial-failure

**Look for**: a multi-step operation across systems with no plan for failing halfway: charge the card, then create the order, then reserve stock, then send the confirmation; or create a user in the identity provider, then in the database.

**Not a finding when**: all steps are in one database transaction, or the operation is modeled as a state machine with recorded progress, retryable idempotent steps, compensation for steps that cannot be retried, and reconciliation for anything left in between.

**Failure**: step two fails after step one succeeded. The customer is charged with no order, stock is reserved forever for an order that never completed, or a user exists in the identity provider but not in the application and can never sign up again.

**Fix**:
1. Order steps so the hardest-to-undo one comes last where possible (reserve, then charge, then confirm).
2. Record progress durably (a status on the order: `PENDING → CHARGED → FULFILLED`) before and after each external step.
3. Make each step idempotent so it can be retried safely.
4. Add compensation for steps that cannot be retried (refund, release the reservation).
5. Run a reconciliation job that finds records stuck in intermediate states and resolves them.

**Verify**: tests that inject a failure after each step and assert the system ends in a consistent state after retries and reconciliation.

**Severity**: `critical` when money or customer data ends up inconsistent; `high` otherwise.

## failure.unsafe-fallback

**Look for**: a fallback that returns a plausible but wrong value when a dependency fails: price defaults to 0, discount defaults to 100%, permission check defaults to allow, feature-flag service down means every flag is on, exchange rate falls back to 1, a fraud or risk check failing open to "approve", `getOrDefault` on a config value that changes billing.

**Not a finding when**: the fallback is safe when wrong (a generic recommendation list, a cached value with a bounded age, a degraded but honest response), or security and money checks fail closed.

**Failure**: during an outage the system keeps running and confidently does the wrong thing: free orders, unauthorized access, payments approved without fraud checks, invoices in the wrong currency. These incidents are often worse than the outage they hide.

**Fix**: fall back only to values that are safe when wrong. Authorization, pricing, fraud, and payment decisions fail closed. If no safe default exists, fail the request with a clear error and record it.

**Verify**: a test that makes the dependency fail and asserts the fallback outcome is safe (denied, rejected, or clearly degraded).

**Severity**: `critical` for money and authorization; `high` otherwise.

## failure.no-circuit-breaker

**Look for**: a request path that depends on a slow or flaky dependency, especially a non-essential one (recommendations, analytics, enrichment, a third-party widget), with no circuit breaker, bulkhead, or fast failure, so its latency becomes the endpoint's latency.

**Not a finding when**: the dependency is essential and the endpoint cannot respond without it (then timeouts and clear errors are the fix, not a breaker), or a breaker exists at the client, library, or service-mesh level for this call.

**Failure**: the dependency degrades and every request waits for the full timeout. Threads and connections are held, and a non-essential feature takes down the whole endpoint and everything that shares its pool.

**Fix**: wrap the call in a circuit breaker (Resilience4j, Polly, `gobreaker`, `opossum`, or the mesh's outlier detection) that fails fast after repeated errors. Isolate it with its own small pool or concurrency limit (bulkhead). Degrade gracefully: render the page without the optional section.

**Verify**: a test that makes the dependency slow and asserts the endpoint still responds quickly once the breaker opens.

**Severity**: `medium`; `high` when the endpoint is critical and the dependency is optional.

## failure.no-graceful-shutdown

**Look for**: services and workers with no SIGTERM handling, or that exit immediately on it; servers started without graceful shutdown (Go `http.Server` without `Shutdown`, Spring Boot before 3.4 without `server.shutdown=graceful` (3.4 and later enable it by default), Node.js without `server.close()` and connection draining); queue workers that drop in-flight jobs on exit; no `preStop` delay on Kubernetes.

**Not a finding when**: the framework or platform handles draining for this process and it is enabled in the configuration you can see.

**Failure**: every deploy, autoscaling scale-down, or node rotation kills requests and jobs mid-flight. Users see 502s during every release, jobs half-complete, and messages are redelivered. On Kubernetes, the pod is removed from Service endpoints asynchronously, so for a few seconds after SIGTERM new requests still arrive; a server that stops listening immediately drops them.

**Fix**: on SIGTERM:
1. Keep serving for a few seconds (a `preStop` sleep) while load balancers stop routing to the instance; fail readiness.
2. Stop accepting new work: close the listener, stop polling the queue.
3. Finish in-flight requests and jobs within a deadline; commit offsets and acknowledgements for completed work.
4. Exit before the platform kills the process (Kubernetes `terminationGracePeriodSeconds` defaults to 30 seconds).

**Verify**: send SIGTERM during a load test and assert zero failed requests and no lost jobs.

**Severity**: `medium`; `high` for workers processing payments or orders.

## failure.deep-health-check

**Look for**: liveness probes that check downstream dependencies (database, cache, other services, third-party APIs), or one health endpoint used for both liveness and readiness that includes dependency checks.

**Not a finding when**: liveness only checks that the process is alive and responsive, and dependency checks are limited to readiness (or are not used to restart anything).

**Failure**: the database has a 20-second blip. Every instance fails liveness at once, and the orchestrator restarts the entire fleet. Restarts make recovery slower, empty in-process caches, and create a thundering herd of reconnections when the database returns.

**Fix**: liveness answers only "is this process alive and not deadlocked". Readiness may include critical dependencies so traffic stops routing to an instance that cannot serve, without restarting it. Never restart a process because something else is down.

**Verify**: make a dependency unavailable in a test environment and confirm instances become unready but are not restarted.

**Severity**: `high`.
