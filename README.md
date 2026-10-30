<h1 align="center">scar-tissue</h1>

<p align="center">
  <strong>Give your AI coding agent the scar tissue of a thousand production incidents.</strong>
</p>

<p align="center">
  An agent skill for Claude Code, Codex, Cursor, and other coding agents that writes, reviews, and hardens backend code<br>
  like the engineer who gets paged at 3am, and who has cleaned up after a breach.
</p>

<p align="center">
  <a href="https://github.com/aldo01/scar-tissue/actions/workflows/test.yml"><img src="https://github.com/aldo01/scar-tissue/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
  <a href="RULES.md"><img src="https://img.shields.io/badge/rules-90-blue" alt="90 rules"></a>
  <a href="docs/INSTALL.md"><img src="https://img.shields.io/badge/agents-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20Copilot-8A2BE2" alt="Works with Claude Code, Codex, Cursor, Copilot"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license"></a>
</p>

---

AI agents write backend code that passes every test and then fails in production: the retry that double-charges a card, the HTTP call with no timeout that takes down the whole API, the migration that locks a table during a deploy, the endpoint that returns any user's orders if you change the ID in the URL.

Experienced engineers avoid these because they have been burned by them. **scar-tissue** gives that experience to your agent: 90 rules across reliability and security, each one a real class of production incident or attack, each one written as *trigger → what breaks → who notices → smallest fix*, with the framework defaults that cause it, when it is *not* a problem, and how to prove the fix works.

## See it work

<p align="center">
  <img src="demo/demo.gif" alt="scar-tissue audit of a checkout endpoint: 12 findings, 6 critical" width="820">
</p>

Here is a checkout endpoint written the way coding agents usually write it ([`before.py`](examples/payment-api/before.py)). It looks fine. It passes happy-path tests.

```python
@app.post("/checkout")
def checkout(customer_id: str, amount_cents: int, use_wallet: bool = False):
    ...

def charge_with_retry(customer_id, amount_cents):
    for attempt in range(5):
        try:
            resp = requests.post(PAYMENTS_URL, json={...})
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException:
            time.sleep(1)
```

Ask your agent to audit it with scar-tissue and you get ([full report](examples/payment-api/scar-tissue-report.json)):

```
[critical] security.missing-authorization  before.py:31  (also before.py:57)
Checkout and order history act on whatever customer_id the caller sends.
Failure: an unauthenticated attacker calls /checkout?customer_id=<victim>&use_wallet=true
→ spends any customer's wallet, and reads anyone's orders through /orders.
Fix: resolve the customer from a verified session or token, never from the request.

[critical] retries.non-idempotent  before.py:20
Card charge is retried with no idempotency key sent to the provider.
Failure: the provider charges the card, but the connection drops before the response
arrives → the loop charges again, up to five times for one checkout.
Who notices: the customer, who sees up to five identical charges.
Fix: send an Idempotency-Key derived from the checkout's key on every attempt.

[high] timeouts.missing  before.py:22
Payment provider call has no timeout.
Failure: the provider stops responding → Python requests waits indefinitely → every
checkout worker blocks → the whole API stops responding.
Fix: timeout=(3, 10) on every call.

... 12 findings: 6 critical, 5 high, 1 medium. Fix first: ST-001.
```

Then ask it to harden the code, and you get [`after.py`](examples/payment-api/after.py), with every change tagged to the finding it fixes.

## What it catches

| Area | Examples |
| --- | --- |
| **Timeouts & retries** | Calls with no timeout, retry storms, retrying side effects, retries stacked across layers |
| **Idempotency** | Double charges, duplicate orders, redelivered messages processed twice, keys that change between attempts |
| **Concurrency** | Lost updates on balances and inventory, check-then-act races, distributed locks without fencing tokens, unbounded parallelism, cron jobs that run on every replica |
| **Database** | N+1 queries, unbounded queries, deep OFFSET pagination, external calls inside transactions, migrations that lock hot tables |
| **Messaging** | DB write + publish that is not atomic (outbox), ack before processing, poison messages, broken ordering keys |
| **Caching** | Cache stampedes, stale writes, missing TTLs, in-process caches that grow until OOM, lookups for missing keys that skip the cache |
| **Failure handling** | Swallowed errors, partial failures with no recovery, fallbacks that return wrong values, liveness probes that restart the whole fleet |
| **Resource limits** | Unbounded input, loading everything into memory, missing rate limits on costly endpoints, pool exhaustion, leaked connections and goroutines |
| **Data integrity** | Money in floating point, timestamps without time zones, uniqueness enforced only in code, 32-bit IDs about to run out |
| **Observability** | Silent failures, no correlation IDs, secrets in logs, high-cardinality metric labels |
| **Injection** | SQL, command, NoSQL, and template injection, path traversal, unsafe deserialization, XXE, regexes that hang on crafted input |
| **Access control** | Missing authorization, IDOR (change the ID, get someone else's data), cross-tenant leaks, mass assignment, trusting prices and roles sent by the client |
| **Authentication** | JWTs that are decoded but not verified, fast password hashes, insecure session cookies, unsigned webhooks, guessable reset tokens |
| **Request handling** | SSRF to cloud metadata, open redirects, CORS that reflects any origin, CSRF, XSS, unsafe file uploads, stack traces sent to clients |
| **Secrets & config** | Hardcoded keys, MD5 and ECB, `Math.random()` tokens, `verify=False`, debug consoles in production, known-vulnerable dependencies |

See [RULES.md](RULES.md) for all 90 rules with links to their full descriptions. The machine-readable catalog is [`rules.json`](skills/scar-tissue/rules.json).

## No slop findings

Most AI code reviews bury real problems under "consider adding logging" and "follow best practices". scar-tissue has one hard rule:

> **If you cannot describe the concrete failure (the trigger, what breaks, and who notices), it is not a finding.**

Machine-readable reports are checked by [`validate-findings.cjs`](skills/scar-tissue/validate-findings.cjs), which rejects findings that describe advice instead of a failure, use unknown rules, or claim `likely` without naming the assumption. Every finding carries a confidence level: `confirmed`, `likely`, or `needs-validation`. Add `--format text` to print a validated report in readable form.

## Install

**Claude Code plugin:**

```bash
claude plugin marketplace add aldo01/scar-tissue
claude plugin install scar-tissue@scar-tissue
```

Or inside a session: `/plugin marketplace add aldo01/scar-tissue`, then `/plugin install scar-tissue@scar-tissue`.

**Any agent**, with the [Skills CLI](https://skills.sh):

```bash
npx skills add https://github.com/aldo01/scar-tissue --skill scar-tissue
```

Add `-g` to install it for all your projects, and `-a codex`, `-a cursor`, or `-a github-copilot` to pick your agent.

See [docs/INSTALL.md](docs/INSTALL.md) for every agent's install path, manual install, and setup for agents that only read `AGENTS.md`.

## Use it

The skill has three modes:

| Mode | When | What it does |
| --- | --- | --- |
| **Guidance** (default) | Your agent writes or edits backend code | Applies the rules quietly as it writes: timeouts, idempotency keys, bounds, atomic updates. One line of explanation when it adds one. |
| **Audit** | "Audit this service for production readiness", "Security review this API" | Finds problems, reports them by severity with file and line, changes nothing. |
| **Harden** | "Harden the payments module" | Audits first, then fixes in severity order with the smallest effective change. |

Example prompts:

```text
Audit src/payments for production readiness with scar-tissue.
Do a security review of the API handlers with scar-tissue.
Harden the order consumer. Fix critical and high findings only.
Write a webhook handler for Stripe events.            ← guidance mode applies automatically
Audit this PR's diff with scar-tissue and write scar-tissue-report.json.
```

## Severity means production impact

| Severity | Meaning |
| --- | --- |
| `critical` | Wrong money, lost or corrupted data, or a full outage under normal conditions |
| `high` | Outage or data problem under load, partial failure, or a routine deploy |
| `medium` | Degradation, slow recovery, or an incident that is hard to diagnose |
| `low` | Real but unlikely, or cheap to recover from |

Security findings are rated by who can exploit them and what they get: an unauthenticated attacker reaching data or code execution is `critical`, a logged-in user reaching other users' data is `high`.

The skill is defensive. It never sends exploit payloads to running systems, proves issues only with local tests, and never prints full secrets in a report.

## Contributing a scar

Every rule should come from a failure or attack that actually happens in production. New rules, false-positive reports, and better framework coverage are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the six-part rule format and the quality bar.

War stories in the PR description are welcome. They are the point.

## License

[MIT](LICENSE)
