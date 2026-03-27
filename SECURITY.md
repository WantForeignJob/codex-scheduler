# Security Policy

## Supported versions

Security fixes are applied to the latest development state of this repository. Older snapshots may
not receive coordinated patches.

## Reporting a vulnerability

Please do not open a public issue with exploit details, credentials, tokens, logs, database
contents, or customer data.

Instead:

1. Contact the maintainers through a private channel if one is available.
2. Share a short description, impact, affected version or commit, reproduction steps, and any
   suggested mitigation.
3. Include only the minimum data needed to understand the issue.

If no private channel is available yet, open a public issue with a minimal description such as
"security report: private contact requested" and do not include sensitive details.

## Scope

Security reports are especially helpful for:

- Credential or token exposure
- Unsafe repository mutation or command execution
- Sandbox or workspace escape risks
- Linear, GitHub, or OpenAI integration flaws
- Sensitive data leakage in reports, logs, or delivery artifacts

## Response goals

The maintainers will try to acknowledge valid reports promptly, reproduce the issue, and coordinate
a fix before public disclosure whenever practical.
