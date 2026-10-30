# Contributing to scar-tissue

Every rule in scar-tissue should come from a failure or attack that actually happens in production. The best contributions are new rules backed by a real incident, fixes to rules that produced false positives, and better framework coverage for existing rules.

## Ways to contribute

- **Report a false positive.** Open an issue with the code, the finding, and why it is safe. False positives are the most useful reports, because the "Not a finding when" sections are what keep reviews free of noise.
- **Report a missed bug.** Open an issue with the code and the failure it caused or would cause.
- **Add a rule.** Follow the steps below.
- **Improve an existing rule.** Add a framework, a default that causes the problem, or a mitigation that makes it safe.

## Adding a rule

1. Pick the reference file in [`skills/scar-tissue/`](skills/scar-tissue/) that matches the area. Create a new file only if the rule fits none of them.
2. Add a `## area.rule-name` heading. Rule IDs are lowercase, use the file's prefix (`timeouts.`, `security.`, and so on), and never change once released.
3. Write these six parts, in this order:

   | Part | What goes in it |
   | --- | --- |
   | **Look for** | The code shapes and framework defaults that cause the problem, per stack. Name the exact API, setting, and default value. |
   | **Not a finding when** | The mitigations that make the code safe, including central configuration a reviewer might miss. |
   | **Failure** | A concrete scenario: the trigger, what breaks, and who notices. |
   | **Fix** | The smallest effective change. |
   | **Verify** | The test or check that proves the fix works. |
   | **Severity** | The typical severity, and when to raise or lower it. |

4. Add the rule ID to the file's `## Contents` list, in the same order as the headings.
5. Add the rule to [`rules.json`](skills/scar-tissue/rules.json) with its title, typical severity, and file.
6. Run `npm run rules` to regenerate [RULES.md](RULES.md).
7. Run `npm test`.

## Quality bar

- **Facts must be checkable.** If a rule says a library has no default timeout, or retries three times, it must be true for current versions. Link the source in your pull request.
- **No advice-only rules.** If you cannot describe the concrete failure, it is not a rule.
- **Write for an agent.** Be specific and short. Agents follow concrete instructions and skip vague ones.
- **Reference files do not link to each other.** Agents load one reference file at a time, so each must stand on its own.
- **Security rules are defensive.** Describe the vulnerable pattern and the fix. Do not include working exploits for specific products.

## Running the checks

```bash
npm test                  # structure tests and validator tests
npm run validate:example  # validates the example report
```

The tests check that every rule has all six parts in order, that the Contents lists and `rules.json` match the documented rules, that reference files do not cross-link, and that the example report is valid.

## Pull requests

Keep each pull request to one rule or one fix. War stories in the description are welcome. They are the point.
