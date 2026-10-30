# scar-tissue

scar-tissue makes Claude write, review, and harden backend code the way an engineer who has been paged at 3am would. It covers 90 rules across production reliability and security: missing timeouts, unsafe retries, double charges, race conditions, unbounded queries, unsafe migrations, lost events, cache stampedes, swallowed errors, injection, broken access control, tenant isolation, SSRF, JWT and session flaws, unverified webhooks, hardcoded secrets, and weak cryptography.

Every finding must name a concrete failure: the trigger, what breaks, and who notices. If the failure cannot be described, it is not reported. That rule keeps reviews free of generic advice.

## How to use it

The skill has three modes:

- **Guidance** (default): while Claude writes backend code, it applies safe defaults such as timeouts, idempotency keys, bounded queries, atomic updates, and authorization checks.
- **Audit**: ask Claude to audit or security-review code. It reports findings by severity with file and line, and changes nothing.
- **Harden**: ask Claude to harden code. It audits first, then fixes findings in severity order with the smallest effective change.

Example requests: "Audit the payments service for production readiness", "Do a security review of the API handlers", "Harden the order consumer".

## What this plugin contains and does

- Instructions and reference documents that Claude reads. The code snippets in them are examples of vulnerable patterns for Claude to recognize. The plugin never runs them.
- A local validator script that checks a findings report against the bundled schema. Claude runs it with Node.js only when you ask for a machine-readable report. It reads the report file and the bundled rule list, writes only to the terminal, reads no environment variables or credentials, and makes no network requests.

The plugin has no hooks, MCP servers, or background processes, and it sends no data anywhere. During security reviews the skill instructs Claude never to test against live or third-party systems and never to print secrets it finds.

## License

MIT. Source, examples, and contribution guide: https://github.com/aldo01/scar-tissue
