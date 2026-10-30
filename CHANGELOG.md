# Changelog

All notable changes to scar-tissue are listed here. Rule IDs are stable: a released rule ID is never renamed or reused.

## 0.1.2 - 2026-10-30

### Changed

- Renamed internal identifiers in `validate-findings.cjs` and reworded two documentation examples that Anthropic's plugin directory scanner matched as credential access and download-and-run patterns. No behavior change.

## 0.1.1 - 2026-10-30

### Changed

- The Claude Code plugin now ships only the skill folder (`skills/scar-tissue`), not the whole repository. Tests, examples, and the demo stay out of installs.
- Plugin icon and listing links for Anthropic's plugin directory.
- `validate-findings.cjs` no longer reads environment variables. Use `--color` or `--no-color` to control color in `--format text` output.
- Tests moved from the skill folder to `test/`.

## 0.1.0 - 2026-10-30

First release.

### Rules

- 58 reliability rules across timeouts and retries, idempotency, concurrency, databases, messaging, caching, failure handling, resource limits, data integrity, and observability.
- 32 security rules across injection, access control, authentication, request handling, and secrets and configuration.
- Every rule has six parts: Look for, Not a finding when, Failure, Fix, Verify, Severity. See [RULES.md](RULES.md).

### Skill

- Three modes: guidance (default, while writing code), audit (report only), and harden (audit, then fix in severity order).
- Audit workflow with a security pass that traces untrusted input to sensitive operations and checks authorization on every handler.
- Security safety rules: no testing against live systems, no secrets in reports.

### Tooling

- `report-schema.json` for machine-readable reports.
- `validate-findings.cjs`: a dependency-free validator that rejects advice-only findings, unknown rules, missing assumptions, and wrong summary counts. `--format text` prints a validated report in readable form.
- Tests that keep the rule files, `rules.json`, `RULES.md`, and the README in sync.

### Install

- Claude Code plugin and marketplace.
- Skills CLI for Codex, Cursor, GitHub Copilot, Gemini CLI, Windsurf, OpenCode, and others. See [docs/INSTALL.md](docs/INSTALL.md).

### Example

- A payment API checkout endpoint with 12 findings (6 critical, 5 high, 1 medium), the validated report, and the hardened version.
