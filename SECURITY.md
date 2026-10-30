# Security policy

## Reporting a vulnerability in scar-tissue

If you find a security problem in this repository, such as the validator executing untrusted input or instructions in the skill that would make an agent take an unsafe action, please report it privately:

1. Go to the [Security tab](https://github.com/aldo01/scar-tissue/security) of this repository.
2. Click **Report a vulnerability**.

Please do not open a public issue for security problems. You can expect an acknowledgement within 3 days.

## Vulnerabilities found by scar-tissue in other projects

scar-tissue can find security vulnerabilities in the code it reviews. If you use it on a project you do not own and it finds one:

- Report it privately to that project's maintainers, following their `SECURITY.md` or GitHub's private reporting. Do not open a public issue or pull request that describes it.
- Confirm the issue only by reading code or running tests locally. Never test against systems you do not own.
- Give maintainers reasonable time to fix it before anything is disclosed.

## Supported versions

Only the latest version on the `main` branch is supported.
