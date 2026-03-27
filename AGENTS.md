# Codex Scheduler Repository Rules

## Purpose
- This repository hosts the Codex scheduler service and its tests.
- The service runs locally on `localhost` and orchestrates Codex-driven repository automation.

## Change Rules
- Keep the codebase TypeScript-first and Node 24 compatible.
- Prefer small modules with explicit types and predictable state transitions.
- Do not write directly into target repositories outside the scheduler-managed workspace flow.
- Preserve the separation between orchestration code, external integrations, and HTTP transport.

## Validation
- Run `pnpm test` for automated tests.
- Run `pnpm build` for TypeScript compilation before finishing substantial changes.
- If database schema changes, ensure Drizzle schema and migration entrypoints stay in sync.

## GitHub Submission Safety
- Before any commit, push, PR, or other GitHub submission, review staged and unstaged changes plus any generated artifacts for secrets and sensitive data.
- Sensitive data includes keys, tokens, passwords, private keys, certificates, cookies, connection strings, `.env` files, personal data, customer data, internal URLs, internal docs, raw logs, exports, and any other non-public information.
- If sensitive data is found, stop submission and remove, redact, rotate, or clean history before continuing.
- Report the checked scope and remediation result before any GitHub submission.
