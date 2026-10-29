---
name: scar-tissue
description: Reviews, audits, and hardens backend code for production failures and security vulnerabilities. Covers reliability (missing timeouts, unsafe retries, double charges, race conditions, N+1 and unbounded queries, unsafe migrations, lost events, cache stampedes, swallowed errors, float money, resource exhaustion) and security (SQL and command injection, broken access control and IDOR, tenant isolation, SSRF, path traversal, unsafe deserialization, JWT and session flaws, unverified webhooks, hardcoded secrets, weak cryptography, vulnerable dependencies). Applies safe defaults while writing backend code. Use when writing or changing APIs, services, workers, queue consumers, scheduled jobs, database queries, or migrations, and when the user asks for a production-readiness review, security review, audit, or hardening.
---

# scar-tissue

Write and review backend code the way an engineer who has been paged at 3am, and who has cleaned up after a breach, would. Every rule in this skill is a class of real production incident or real attack. The job is to find the specific line that will break or be exploited in production, prove how, and apply the smallest fix that prevents it.

This skill is defensive. See "Security safety rules" before running anything during a security review.

## Contents

- Operating modes
- The finding standard
- The boundary questions
- Audit workflow
- Harden workflow
- Security safety rules
- Guidance mode: defaults for new code
- Severity and confidence
- Report format
- Reference files

## Operating modes

Loading this skill does not authorize file creation or a full audit. Pick the mode from the request:

| Mode | Triggered by | Behavior |
| --- | --- | --- |
| **Guidance** (default) | Writing or editing backend code | Apply the rules while writing. Use the defaults below. When you add a safeguard (timeout, idempotency key, bound, atomic update, authorization check, parameterized query), say why in one short line. Do not lecture about rules that do not apply. |
| **Audit** | "review", "audit", "security review", "is this production ready", "what could break", "is this secure" | Follow the audit workflow. Report findings. Do not modify code. |
| **Harden** | "harden", "fix production issues", "fix security issues", "make this production ready" | Run the audit workflow, show findings, then follow the harden workflow. |

If the request is ambiguous between audit and harden, ask one short question before changing code. If the user asks only for reliability or only for security, limit the audit to those reference files.

## The finding standard

A finding is a specific location in the code plus a **failure scenario**: the trigger, what breaks, and who notices.

> Trigger: the client times out after 10s and retries. What breaks: `charge()` runs twice because nothing identifies the repeat. Who notices: the customer, on their card statement.

Rules for findings:

- **No failure scenario, no finding.** "Consider adding logging", "follow best practices", and "this could be improved" are not findings.
- **One finding per root cause.** If the same problem appears at ten call sites, report it once and list the other locations.
- **Check for mitigations before reporting.** Each rule has a "Not a finding when" section. Timeouts, retries, limits, and locks are often configured centrally (shared client, framework config, middleware, database constraint, infrastructure). Look for them. If you cannot see where they would be configured, report with confidence `likely` and name the assumption.
- **Do not inflate severity.** Rate the realistic production impact, not the worst imaginable one.
- **Fewer, real findings beat many weak ones.** A report with three real failures is better than one with thirty suggestions.

For **security findings**, the trigger is a concrete attacker action, and it must name the attacker's position: an unauthenticated internet user, an authenticated user, a user of another tenant, a user who can upload files, someone who can reach the network path, or someone with repository access. A security finding is `confirmed` only when you have traced attacker-controlled input from where it enters to the dangerous operation, with no effective control on the path. If a framework protection might apply that you cannot see, use `likely`.

Good finding:

```
[critical] concurrency.lost-update  app/wallet.py:38
Wallet debited with read-modify-write.
Failure: two checkouts for the same customer run concurrently → both read balance 100 →
both write 100 - amount → one debit is lost and the order is paid for with money that was already spent.
Fix: UPDATE wallets SET balance = balance - :amt WHERE id = :id AND balance >= :amt; treat 0 rows as insufficient funds.
Confidence: confirmed
```

Bad finding (do not write these):

```
[medium] Consider using transactions for better data consistency in the wallet module.
```

## The boundary questions

Every place the code crosses a boundary (network call, database write, queue publish, file, another process), touches shared state, accepts input from outside, or performs a privileged action, ask:

1. **What if it is slow?** Is there a timeout shorter than the caller's deadline? → `timeouts.*`
2. **What if it fails?** Is the error handled, surfaced, and safe? → `failure.*`
3. **What if it succeeded but the response was lost?** Will a retry repeat the side effect? → `idempotency.*`, `retries.*`
4. **What if it runs twice?** Retries, redeliveries, double clicks, duplicate cron runs. → `idempotency.*`, `messaging.*`
5. **What if two run at the same time?** → `concurrency.*`
6. **What if the input is 1,000 times bigger?** → `limits.*`, `database.*`
7. **What happens during a deploy?** Old and new code running together, SIGTERM mid-request, migrations on a live table. → `database.unsafe-migration`, `failure.no-graceful-shutdown`
8. **Who controls this input, and where does it end up?** Follow it to queries, shells, file paths, templates, deserializers, outbound URLs, redirects, and HTML. → `security.*` in SECURITY-INJECTION.md and SECURITY-REQUEST-HANDLING.md
9. **Who is allowed to do this, and where is that checked?** Identity from a verified session or token, ownership of the object, tenant of the data. → `security.*` in SECURITY-ACCESS-CONTROL.md and SECURITY-AUTHENTICATION.md

## Audit workflow

Copy this checklist into your response and work through it in order:

```
Audit progress:
- [ ] 1. Scope: list entry points
- [ ] 2. Inventory: side effects, external calls, shared state, untrusted inputs, sensitive sinks, authorization points
- [ ] 3. Load the relevant reference files
- [ ] 4. Trace each critical path
- [ ] 5. Security pass: inputs to sinks, authorization, secrets and config, dependencies
- [ ] 6. Verify each candidate finding
- [ ] 7. Calibrate, deduplicate, order
- [ ] 8. Report (and validate JSON if requested)
```

1. **Scope.** List the entry points in the target: HTTP handlers, RPC methods, queue consumers, webhook receivers, scheduled jobs, CLI commands, migrations. If the target is large, start with the ones that are publicly reachable, move money, mutate data, or are on the hottest path.
2. **Inventory.** For each entry point, list:
   - every side effect (writes, charges, messages, emails, external mutations);
   - every external call (HTTP, RPC, database, cache, queue, cloud SDK);
   - every piece of shared state (balances, counters, inventory, status fields, in-process caches);
   - every untrusted input (parameters, headers, cookies, bodies, files, webhook and message payloads);
   - every sensitive sink (SQL, shell, file paths, templates, deserializers, outbound URLs, redirects, HTML output);
   - where the caller's identity and permissions are established and checked.
3. **Load references.** Read only the reference files for the categories present in the inventory. A read-only reporting service does not need MESSAGING.md; a service with no XML parsing does not need the XXE rule.
4. **Trace.** Walk each critical path from input to response in execution order. At every boundary in the inventory, ask the boundary questions. Write down candidate findings with file and line.
5. **Security pass.**
   - Follow each untrusted input to every sink it reaches, including through helper functions, and check that it stays data the whole way.
   - For every handler that reads or changes data, find where authentication, object ownership, and tenant scope are checked. A missing check is a candidate finding.
   - Scan configuration, build files, and source for secrets, debug settings, disabled TLS verification, and weak cryptography.
   - Run the dependency audit tool for the ecosystem if it is available (see `security.vulnerable-dependency`), within the security safety rules.
6. **Verify.** For each candidate:
   - Re-read the exact code and the surrounding call chain.
   - Check the rule's "Not a finding when" list.
   - Search for central configuration that would mitigate it (client factories, framework config, security configuration, base classes, middleware, schema and migration files, gateway and infrastructure config in the repo).
   - Write the failure scenario. If you cannot, drop the candidate.
   - Set confidence: `confirmed` if the failure follows from code you read; `likely` if it depends on something you cannot see (name it); `needs-validation` if it needs a test or a config check (say which).
7. **Calibrate.** Assign severity from the table below. Merge duplicates into one finding with `also_at` locations. Order by severity, most severe first.
8. **Report.** Use the report format below. End with counts by severity and the one finding to fix first, which is usually the highest-severity finding whose fix also removes or reduces others.

## Harden workflow

1. Run the audit workflow and show the findings first.
2. Fix in severity order. Unless told otherwise, fix `critical` and `high`; list `medium` and `low` for the user to decide.
3. For each fix:
   - Make the smallest change that removes the failure. Keep the existing framework, libraries, and style. Do not add a dependency for something the existing stack already does.
   - Fix at the layer where the failure happens: idempotency at the boundary of the side effect, invariants in the database, timeouts on the client.
   - Never add a retry without also adding a timeout, a bound on attempts, backoff with jitter, and idempotency for the retried operation.
   - Restate the failure scenario and confirm the change prevents it.
   - Apply the rule's **Verify** step: add or update a test where the codebase has tests for that area.
4. Run the project's existing tests, linters, and type checks. Fix what you broke.
5. If a fix needs a schema change, write it as a safe migration (see `database.unsafe-migration`). If it needs infrastructure or configuration you cannot change, say exactly what must change and where.
6. Summarize: what was fixed, what was deliberately left, and what needs a decision from the user.

For security fixes, also: rotate any credential that was exposed (removing it from code is not enough), fix the whole class of issue rather than the single payload you tested (parameterize every query on the path, not only the one you tried), and prefer framework mechanisms (ORM parameters, the framework's authorization layer, its CSRF protection) over hand-written filters.

## Security safety rules

These apply in every mode:

- **Do not attack running systems.** Never send exploit payloads to production, staging, or third-party systems, and never use discovered credentials. Demonstrate vulnerabilities only with tests against local code, fixtures, or a disposable environment the user controls.
- **Do not reveal secrets.** When reporting a secret, show the file, line, and type of secret, and at most its first four characters. Never copy secrets into reports, commit messages, or test files.
- **Read before you run.** Source inspection is read-only. Run project code, tests, or tools only as the user's normal workflow would (their test command, their audit tool), and do not let them reach production resources.
- **Network-using tools need care.** Dependency audit tools download advisory data; that is fine. Do not run scanners that probe hosts.
- **Stay in scope.** Review the code you were asked to review. Note, but do not investigate, issues in systems outside the repository.

## Guidance mode: defaults for new code

When writing new backend code, use these starting points unless the codebase already defines its own. They are defaults, not laws: tune them to the dependency's measured latency and the product's needs, and follow existing conventions in the repository first.

| Concern | Default |
| --- | --- |
| HTTP/RPC connect timeout | 2–5 s |
| HTTP/RPC request timeout | 2–3× the dependency's p99 latency, typically 5–30 s, and always shorter than the caller's own deadline |
| Database statement timeout on request paths | 2–10 s (longer only for known batch jobs) |
| Retries | Transient errors only; at most 3 attempts in total; exponential backoff from 100–500 ms, capped at 2–10 s, with full jitter; honor `Retry-After` |
| Side-effecting endpoints | Accept an idempotency key; enforce with a unique constraint |
| List endpoints | Default page size 50, server-enforced maximum 100–500, keyset pagination for large tables |
| Request bodies and batch inputs | Explicit maximum size and item count |
| Queue consumers | Acknowledge after processing; idempotent handler; 3–5 delivery attempts, then dead-letter |
| Batch jobs | 500–5,000 rows per transaction, resumable from a checkpoint |
| Money | Integer minor units or a decimal type, never binary floating point |
| Time | Timezone-aware UTC timestamps for instants |
| Shutdown | Stop taking new work on SIGTERM, drain in-flight work within the platform's grace period |
| Logging | Structured, with a request or trace ID, no secrets or personal data |
| Authentication and authorization | Deny by default; identity only from a verified session or token; ownership and tenant checked on every object access |
| Queries and commands | Bound parameters for every value; allowlists for identifiers; no shell, arguments as arrays |
| Request types | Explicit request schemas with allowed fields and types; never bind requests to persistence models |
| Secrets and tokens | From a secret manager or environment; tokens from a cryptographically secure generator, at least 128 bits |
| Outbound requests to user-supplied URLs | Allowlist, or block private and metadata addresses after DNS resolution; redirects off |
| Passwords | Argon2id, scrypt, or bcrypt through a maintained library |

## Severity and confidence

| Severity | Production impact | Example |
| --- | --- | --- |
| `critical` | Wrong money, lost or corrupted data, or a full outage under normal conditions | A retry double-charges a card |
| `high` | Outage or data problem under load, during partial failure, or during a routine deploy | No timeout on a payment provider call, so a slow provider exhausts the worker pool |
| `medium` | Degradation, slow recovery, or an incident that is hard to diagnose | No correlation ID across services |
| `low` | Real but unlikely, or cheap to recover from | Unbounded cache on a rarely used admin path |

Lower the severity when the trigger needs unusual conditions, the blast radius is small, or the path is not user-facing. Raise it when money, personal data, or a hot path is involved.

For security findings, rate by **who can exploit it** and **what they get**:

| Severity | Security examples |
| --- | --- |
| `critical` | An unauthenticated attacker gets code execution, database access, account takeover, other users' or tenants' data at scale, or production credentials |
| `high` | An authenticated user reads or changes other users' data, escalates privileges, or reaches internal services; stored XSS |
| `medium` | Exploitation needs user interaction or yields limited impact: CSRF on a modest action, open redirect, reflected XSS, detailed error disclosure |
| `low` | Hard to exploit or minor information disclosure |

| Confidence | Meaning | Required |
| --- | --- | --- |
| `confirmed` | The failure follows directly from code you read | — |
| `likely` | Depends on something you could not see (framework default, deployment config) | Name the assumption |
| `needs-validation` | Plausible but needs a test, load test, or config check | Say exactly what to check |

## Report format

Present findings grouped by severity, most severe first:

```
[severity] rule.id  path/to/file.ext:line
One-line title.
Failure: trigger → what breaks → who notices.
Fix: the smallest effective change.
Confidence: confirmed | likely (assumption) | needs-validation (what to check)
Also at: other/file.ext:12, other/file.ext:88        ← only if applicable
```

End with: `N findings: X critical, Y high, Z medium, W low. Fix first: <finding>.`

**Machine-readable report.** Only when the user asks for one, write `scar-tissue-report.json` conforming to [report-schema.json](report-schema.json), then run the validator and loop until it passes:

```bash
node <path-to-this-skill>/validate-findings.cjs scar-tissue-report.json
```

If it reports errors, fix the report and run it again. Do not present the report until validation passes. The validator rejects unknown rule IDs, findings whose failure scenario is advice rather than a failure, `likely` findings without an assumption, and summaries whose counts do not match.

## Reference files

Each reference file is a set of rules. Every rule has the same sections: **Look for**, **Not a finding when**, **Failure**, **Fix**, **Verify**, and **Severity**. Load only what the inventory needs.

| File | Rules about |
| --- | --- |
| [TIMEOUTS-AND-RETRIES.md](TIMEOUTS-AND-RETRIES.md) | Missing timeouts, deadline budgets, retry storms, retrying side effects, retry amplification, retrying permanent errors |
| [IDEMPOTENCY.md](IDEMPOTENCY.md) | Duplicate side effects from retries, double submits, redelivered messages, unstable keys |
| [CONCURRENCY.md](CONCURRENCY.md) | Lost updates, check-then-act races, distributed locks, unbounded parallelism, shared mutable state, duplicate scheduled jobs |
| [DATABASE.md](DATABASE.md) | N+1 queries, unbounded queries, deep pagination, missing indexes, external calls in transactions, long transactions, statement timeouts, unsafe migrations |
| [MESSAGING.md](MESSAGING.md) | Dual writes and the outbox pattern, acknowledgement timing, poison messages, ordering keys, lease and poll timeouts |
| [CACHING.md](CACHING.md) | Stampedes, stale writes, missing TTLs, unbounded in-process caches, cache-only data, cache penetration |
| [FAILURE-HANDLING.md](FAILURE-HANDLING.md) | Swallowed errors, partial failure, unsafe fallbacks, circuit breakers, graceful shutdown, health checks |
| [RESOURCE-LIMITS.md](RESOURCE-LIMITS.md) | Unbounded input, loading everything into memory, rate limits, pool exhaustion, unbounded queues, resource leaks |
| [DATA-INTEGRITY.md](DATA-INTEGRITY.md) | Floating-point money, naive timestamps, constraints enforced only in application code, ID overflow |
| [OBSERVABILITY.md](OBSERVABILITY.md) | Silent failures, missing correlation IDs, sensitive data in logs, metric cardinality, missing signals on critical paths |
| [SECURITY-INJECTION.md](SECURITY-INJECTION.md) | SQL, command, NoSQL, and template injection; path traversal; unsafe deserialization; XXE; ReDoS |
| [SECURITY-ACCESS-CONTROL.md](SECURITY-ACCESS-CONTROL.md) | Missing authorization, IDOR, tenant isolation, mass assignment, trusting client-sent prices and roles |
| [SECURITY-AUTHENTICATION.md](SECURITY-AUTHENTICATION.md) | JWT validation, password storage, session cookies, timing-unsafe comparison, webhook signatures, password reset |
| [SECURITY-REQUEST-HANDLING.md](SECURITY-REQUEST-HANDLING.md) | SSRF, open redirects, CORS, CSRF, XSS, file uploads, verbose errors |
| [SECURITY-SECRETS-AND-CONFIG.md](SECURITY-SECRETS-AND-CONFIG.md) | Hardcoded secrets, weak cryptography, insecure randomness, disabled TLS verification, debug features in production, vulnerable dependencies |

The full list of rule IDs is in [rules.json](rules.json). Use only IDs from that list in findings.
