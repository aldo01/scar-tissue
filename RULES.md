# Rules

<!-- Generated from skills/scar-tissue/rules.json by scripts/generate-rules-index.cjs. Do not edit by hand. -->

scar-tissue has 90 rules in 15 areas. Each links to its full description: what to look for, when it is not a finding, the failure, the fix, how to verify it, and severity.

## Timeouts and retries

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`timeouts.missing`](skills/scar-tissue/TIMEOUTS-AND-RETRIES.md#timeoutsmissing) | high | Outbound call has no timeout |
| [`timeouts.budget-mismatch`](skills/scar-tissue/TIMEOUTS-AND-RETRIES.md#timeoutsbudget-mismatch) | medium | Inner timeout longer than the caller's deadline |
| [`retries.no-backoff`](skills/scar-tissue/TIMEOUTS-AND-RETRIES.md#retriesno-backoff) | high | Retries without exponential backoff and jitter |
| [`retries.unbounded`](skills/scar-tissue/TIMEOUTS-AND-RETRIES.md#retriesunbounded) | high | Retries with no attempt or time limit |
| [`retries.non-idempotent`](skills/scar-tissue/TIMEOUTS-AND-RETRIES.md#retriesnon-idempotent) | critical | Retrying an operation with side effects |
| [`retries.amplification`](skills/scar-tissue/TIMEOUTS-AND-RETRIES.md#retriesamplification) | medium | Retries stacked at multiple layers |
| [`retries.permanent-errors`](skills/scar-tissue/TIMEOUTS-AND-RETRIES.md#retriespermanent-errors) | low | Retrying errors that will never succeed |

## Idempotency

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`idempotency.missing-key`](skills/scar-tissue/IDEMPOTENCY.md#idempotencymissing-key) | critical | Side-effecting operation cannot detect repeats |
| [`idempotency.check-then-insert`](skills/scar-tissue/IDEMPOTENCY.md#idempotencycheck-then-insert) | high | Deduplication by query-then-insert instead of a unique constraint |
| [`idempotency.key-stored-after-effect`](skills/scar-tissue/IDEMPOTENCY.md#idempotencykey-stored-after-effect) | high | Idempotency key recorded after the side effect |
| [`idempotency.consumer-not-idempotent`](skills/scar-tissue/IDEMPOTENCY.md#idempotencyconsumer-not-idempotent) | high | Message or webhook handler not safe to run twice |
| [`idempotency.unstable-key`](skills/scar-tissue/IDEMPOTENCY.md#idempotencyunstable-key) | high | Idempotency key changes between attempts |

## Concurrency

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`concurrency.lost-update`](skills/scar-tissue/CONCURRENCY.md#concurrencylost-update) | critical | Read-modify-write without a lock or condition |
| [`concurrency.check-then-act`](skills/scar-tissue/CONCURRENCY.md#concurrencycheck-then-act) | high | Application-level check before a dependent action |
| [`concurrency.lock-without-fencing`](skills/scar-tissue/CONCURRENCY.md#concurrencylock-without-fencing) | high | Distributed lock can expire while work continues |
| [`concurrency.unbounded-parallelism`](skills/scar-tissue/CONCURRENCY.md#concurrencyunbounded-parallelism) | high | One task per item with no concurrency limit |
| [`concurrency.shared-mutable-state`](skills/scar-tissue/CONCURRENCY.md#concurrencyshared-mutable-state) | high | Request handlers mutate shared state |
| [`concurrency.duplicate-scheduled-job`](skills/scar-tissue/CONCURRENCY.md#concurrencyduplicate-scheduled-job) | high | Scheduled job runs on every replica or overlaps itself |

## Database

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`database.n-plus-one`](skills/scar-tissue/DATABASE.md#databasen-plus-one) | medium | Query executed once per row in a loop |
| [`database.unbounded-query`](skills/scar-tissue/DATABASE.md#databaseunbounded-query) | high | Query or list endpoint without a limit |
| [`database.deep-offset-pagination`](skills/scar-tissue/DATABASE.md#databasedeep-offset-pagination) | medium | OFFSET pagination over large tables |
| [`database.missing-index`](skills/scar-tissue/DATABASE.md#databasemissing-index) | medium | Query filters or sorts on unindexed columns |
| [`database.network-call-in-transaction`](skills/scar-tissue/DATABASE.md#databasenetwork-call-in-transaction) | high | External call made inside a database transaction |
| [`database.long-transaction`](skills/scar-tissue/DATABASE.md#databaselong-transaction) | medium | Transaction spans a large batch or long work |
| [`database.missing-statement-timeout`](skills/scar-tissue/DATABASE.md#databasemissing-statement-timeout) | medium | No statement or query timeout |
| [`database.unsafe-migration`](skills/scar-tissue/DATABASE.md#databaseunsafe-migration) | high | Migration locks a large table or breaks rolling deploys |

## Messaging

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`messaging.dual-write`](skills/scar-tissue/MESSAGING.md#messagingdual-write) | critical | Database write and message publish not atomic |
| [`messaging.ack-before-processing`](skills/scar-tissue/MESSAGING.md#messagingack-before-processing) | high | Message acknowledged before work completes |
| [`messaging.poison-message`](skills/scar-tissue/MESSAGING.md#messagingpoison-message) | high | Failing message retried forever with no dead-letter queue |
| [`messaging.ordering-key`](skills/scar-tissue/MESSAGING.md#messagingordering-key) | high | Ordered events published without a stable ordering key |
| [`messaging.visibility-timeout`](skills/scar-tissue/MESSAGING.md#messagingvisibility-timeout) | medium | Lease expires before processing finishes |

## Caching

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`caching.stampede`](skills/scar-tissue/CACHING.md#cachingstampede) | high | Hot key expiry sends every miss to the backend |
| [`caching.stale-write`](skills/scar-tissue/CACHING.md#cachingstale-write) | medium | Update order can write stale data into the cache |
| [`caching.missing-ttl`](skills/scar-tissue/CACHING.md#cachingmissing-ttl) | medium | Cache entries with no expiry |
| [`caching.unbounded-local`](skills/scar-tissue/CACHING.md#cachingunbounded-local) | medium | In-process cache with no size limit |
| [`caching.cache-as-source-of-truth`](skills/scar-tissue/CACHING.md#cachingcache-as-source-of-truth) | high | Important data stored only in a volatile cache |
| [`caching.penetration`](skills/scar-tissue/CACHING.md#cachingpenetration) | medium | Lookups for nonexistent keys always bypass the cache |

## Failure handling

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`failure.swallowed-error`](skills/scar-tissue/FAILURE-HANDLING.md#failureswallowed-error) | high | Error caught and ignored |
| [`failure.partial-failure`](skills/scar-tissue/FAILURE-HANDLING.md#failurepartial-failure) | critical | Multi-step operation with no recovery for partial failure |
| [`failure.unsafe-fallback`](skills/scar-tissue/FAILURE-HANDLING.md#failureunsafe-fallback) | critical | Fallback returns a plausible but wrong value |
| [`failure.no-circuit-breaker`](skills/scar-tissue/FAILURE-HANDLING.md#failureno-circuit-breaker) | medium | Non-essential dependency can take down the request path |
| [`failure.no-graceful-shutdown`](skills/scar-tissue/FAILURE-HANDLING.md#failureno-graceful-shutdown) | medium | In-flight work dropped on shutdown |
| [`failure.deep-health-check`](skills/scar-tissue/FAILURE-HANDLING.md#failuredeep-health-check) | high | Liveness probe depends on downstream systems |

## Resource limits

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`limits.unbounded-input`](skills/scar-tissue/RESOURCE-LIMITS.md#limitsunbounded-input) | high | Request size, list length, or page size not limited |
| [`limits.load-all-into-memory`](skills/scar-tissue/RESOURCE-LIMITS.md#limitsload-all-into-memory) | high | Entire file, response, or result set loaded into memory |
| [`limits.missing-rate-limit`](skills/scar-tissue/RESOURCE-LIMITS.md#limitsmissing-rate-limit) | high | Expensive or abusable endpoint without rate limiting |
| [`limits.pool-exhaustion`](skills/scar-tissue/RESOURCE-LIMITS.md#limitspool-exhaustion) | high | Connection or thread pool can be exhausted |
| [`limits.unbounded-queue`](skills/scar-tissue/RESOURCE-LIMITS.md#limitsunbounded-queue) | medium | In-memory queue or executor with no capacity limit |
| [`limits.resource-leak`](skills/scar-tissue/RESOURCE-LIMITS.md#limitsresource-leak) | high | Connections, files, or goroutines not released on every path |

## Data integrity

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`data.float-money`](skills/scar-tissue/DATA-INTEGRITY.md#datafloat-money) | high | Money stored or computed in binary floating point |
| [`data.naive-datetime`](skills/scar-tissue/DATA-INTEGRITY.md#datanaive-datetime) | high | Instants stored or compared without a time zone |
| [`data.app-only-constraints`](skills/scar-tissue/DATA-INTEGRITY.md#dataapp-only-constraints) | high | Invariant enforced only in application code |
| [`data.id-overflow`](skills/scar-tissue/DATA-INTEGRITY.md#dataid-overflow) | high | 32-bit identifiers on tables that grow without bound |

## Observability

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`observability.silent-failure`](skills/scar-tissue/OBSERVABILITY.md#observabilitysilent-failure) | medium | Failure path emits no log, metric, or alert |
| [`observability.no-correlation-id`](skills/scar-tissue/OBSERVABILITY.md#observabilityno-correlation-id) | medium | No request or trace ID across service boundaries |
| [`observability.sensitive-data-logged`](skills/scar-tissue/OBSERVABILITY.md#observabilitysensitive-data-logged) | high | Secrets or personal data written to logs |
| [`observability.high-cardinality-labels`](skills/scar-tissue/OBSERVABILITY.md#observabilityhigh-cardinality-labels) | medium | Metric labels from unbounded values |
| [`observability.no-signal-on-critical-path`](skills/scar-tissue/OBSERVABILITY.md#observabilityno-signal-on-critical-path) | medium | Critical business operation has no success/failure metric |

## Security: injection

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`security.sql-injection`](skills/scar-tissue/SECURITY-INJECTION.md#securitysql-injection) | critical | Untrusted input built into a SQL or JPQL query |
| [`security.command-injection`](skills/scar-tissue/SECURITY-INJECTION.md#securitycommand-injection) | critical | Untrusted input reaches a shell or process arguments |
| [`security.nosql-injection`](skills/scar-tissue/SECURITY-INJECTION.md#securitynosql-injection) | high | Query operators injectable through unvalidated input |
| [`security.template-injection`](skills/scar-tissue/SECURITY-INJECTION.md#securitytemplate-injection) | critical | User input compiled as a template or evaluated as an expression |
| [`security.path-traversal`](skills/scar-tissue/SECURITY-INJECTION.md#securitypath-traversal) | high | Untrusted input used to build file paths |
| [`security.unsafe-deserialization`](skills/scar-tissue/SECURITY-INJECTION.md#securityunsafe-deserialization) | critical | Untrusted data passed to a type-instantiating deserializer |
| [`security.xxe`](skills/scar-tissue/SECURITY-INJECTION.md#securityxxe) | high | XML parsed with DTDs or external entities enabled |
| [`security.redos`](skills/scar-tissue/SECURITY-INJECTION.md#securityredos) | high | Backtracking regex with nested quantifiers on untrusted input |

## Security: access control

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`security.missing-authorization`](skills/scar-tissue/SECURITY-ACCESS-CONTROL.md#securitymissing-authorization) | critical | Endpoint does not verify the caller's identity or permission |
| [`security.idor`](skills/scar-tissue/SECURITY-ACCESS-CONTROL.md#securityidor) | high | Object accessed by ID without an ownership check |
| [`security.tenant-isolation`](skills/scar-tissue/SECURITY-ACCESS-CONTROL.md#securitytenant-isolation) | critical | Query, cache, or job can cross tenant boundaries |
| [`security.mass-assignment`](skills/scar-tissue/SECURITY-ACCESS-CONTROL.md#securitymass-assignment) | high | Request body bound to a model without a field allowlist |
| [`security.client-trusted-value`](skills/scar-tissue/SECURITY-ACCESS-CONTROL.md#securityclient-trusted-value) | critical | Server trusts a price, amount, role, or status sent by the client |

## Security: authentication

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`security.jwt-validation`](skills/scar-tissue/SECURITY-AUTHENTICATION.md#securityjwt-validation) | critical | JWT not fully verified (signature, algorithm, expiry, audience) |
| [`security.password-storage`](skills/scar-tissue/SECURITY-AUTHENTICATION.md#securitypassword-storage) | critical | Passwords stored in plaintext or with a fast hash |
| [`security.session-cookies`](skills/scar-tissue/SECURITY-AUTHENTICATION.md#securitysession-cookies) | medium | Session cookie flags, fixation, or invalidation missing |
| [`security.timing-unsafe-compare`](skills/scar-tissue/SECURITY-AUTHENTICATION.md#securitytiming-unsafe-compare) | medium | Secret compared with non-constant-time equality |
| [`security.webhook-signature`](skills/scar-tissue/SECURITY-AUTHENTICATION.md#securitywebhook-signature) | critical | Webhook accepted without a valid signature and replay check |
| [`security.password-reset`](skills/scar-tissue/SECURITY-AUTHENTICATION.md#securitypassword-reset) | high | Weak, reusable, or poisonable password reset tokens |

## Security: request handling

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`security.ssrf`](skills/scar-tissue/SECURITY-REQUEST-HANDLING.md#securityssrf) | critical | Server fetches user-influenced URLs without destination checks |
| [`security.open-redirect`](skills/scar-tissue/SECURITY-REQUEST-HANDLING.md#securityopen-redirect) | medium | Redirect target taken from input |
| [`security.cors-misconfiguration`](skills/scar-tissue/SECURITY-REQUEST-HANDLING.md#securitycors-misconfiguration) | high | CORS lets untrusted origins read credentialed responses |
| [`security.csrf`](skills/scar-tissue/SECURITY-REQUEST-HANDLING.md#securitycsrf) | high | Cookie-authenticated state change without CSRF protection |
| [`security.xss`](skills/scar-tissue/SECURITY-REQUEST-HANDLING.md#securityxss) | high | Untrusted data rendered into HTML without escaping |
| [`security.file-upload`](skills/scar-tissue/SECURITY-REQUEST-HANDLING.md#securityfile-upload) | high | Uploaded files trusted, served inline, or processed unsafely |
| [`security.verbose-errors`](skills/scar-tissue/SECURITY-REQUEST-HANDLING.md#securityverbose-errors) | medium | Stack traces or internals returned to clients |

## Security: secrets and config

| Rule | Severity | What it catches |
| --- | --- | --- |
| [`security.hardcoded-secret`](skills/scar-tissue/SECURITY-SECRETS-AND-CONFIG.md#securityhardcoded-secret) | critical | Credential committed to source or build files |
| [`security.weak-crypto`](skills/scar-tissue/SECURITY-SECRETS-AND-CONFIG.md#securityweak-crypto) | high | Broken algorithm, mode, or nonce handling |
| [`security.insecure-randomness`](skills/scar-tissue/SECURITY-SECRETS-AND-CONFIG.md#securityinsecure-randomness) | high | Non-cryptographic randomness used for secrets or tokens |
| [`security.tls-verification-disabled`](skills/scar-tissue/SECURITY-SECRETS-AND-CONFIG.md#securitytls-verification-disabled) | high | Certificate or hostname verification turned off |
| [`security.debug-in-production`](skills/scar-tissue/SECURITY-SECRETS-AND-CONFIG.md#securitydebug-in-production) | high | Debug consoles, Actuator, or profilers exposed in production |
| [`security.vulnerable-dependency`](skills/scar-tissue/SECURITY-SECRETS-AND-CONFIG.md#securityvulnerable-dependency) | high | Dependency with a known vulnerability, reported by an audit tool |
