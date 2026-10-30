# Installing scar-tissue

scar-tissue is a standard agent skill: a folder with a `SKILL.md` and reference files. Any agent that supports skills can load it.

## Claude Code

Install it as a plugin:

```bash
claude plugin marketplace add aldo01/scar-tissue
claude plugin install scar-tissue@scar-tissue
```

Or, inside a session, run `/plugin marketplace add aldo01/scar-tissue`, then `/plugin install scar-tissue@scar-tissue`.

## Codex, Cursor, GitHub Copilot, Gemini CLI, Windsurf, OpenCode, and others

Use the [Skills CLI](https://skills.sh) and name your agent with `-a`:

```bash
npx skills add https://github.com/aldo01/scar-tissue --skill scar-tissue -a codex
```

Add `-g` to install for all your projects instead of the current one. Use `-a '*'` to install for every agent the CLI supports.

Where the skill ends up:

| Agent | `-a` value | Project path | Global path (`-g`) |
| --- | --- | --- | --- |
| Claude Code | `claude-code` | `.claude/skills/` | `~/.claude/skills/` |
| Codex | `codex` | `.agents/skills/` | `~/.agents/skills/` |
| Cursor | `cursor` | `.agents/skills/` | `~/.cursor/skills/` |
| GitHub Copilot | `github-copilot` | `.agents/skills/` | `~/.copilot/skills/` |
| Gemini CLI | `gemini-cli` | `.agents/skills/` | `~/.gemini/skills/` |
| OpenCode | `opencode` | `.agents/skills/` | `~/.config/opencode/skills/` |
| Windsurf | `windsurf` | `.windsurf/skills/` | `~/.codeium/windsurf/skills/` |

The full list of supported agents is in the [Skills CLI documentation](https://github.com/vercel-labs/skills/blob/main/docs/agents.md).

## Manual install

Copy the [`skills/scar-tissue`](../skills/scar-tissue) folder into your agent's skills directory from the table above. Keep the folder name `scar-tissue` and keep every file in it: `SKILL.md` loads the reference files and the validator from the same folder.

## Agents without skill support

If your agent reads an `AGENTS.md` file but does not support skills, copy the `skills/scar-tissue` folder into your repository (for example to `.agents/skills/scar-tissue/`) and add this to `AGENTS.md`:

```markdown
## Backend reliability and security

When writing, reviewing, or changing backend code (APIs, workers, queue consumers,
scheduled jobs, database queries, migrations), read
`.agents/skills/scar-tissue/SKILL.md` first and follow it. When asked to review,
audit, or harden backend code, follow its audit workflow.
```

## Check that it works

In a clone of this repository, ask your agent:

```text
Audit examples/payment-api/before.py with scar-tissue.
```

A working install reports findings with rule IDs such as `security.missing-authorization` and `retries.non-idempotent`, each with a file, line, and failure scenario.
