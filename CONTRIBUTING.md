# Contributing

Thanks for your interest in improving Codex Scheduler.

## Before you start

- Read [README.md](./README.md) for project goals and local setup.
- Read [AGENTS.md](./AGENTS.md) for repository-specific engineering rules.
- Search existing issues and pull requests before opening a new one.

## Ways to contribute

- Report bugs with a minimal reproduction.
- Propose improvements to scheduling flows, diagnostics, or repository integration.
- Improve tests, docs, examples, and developer experience.
- Review pull requests and share design feedback.

## Development setup

```bash
pnpm install
pnpm approve-builds --all
pnpm db:migrate
pnpm dev
```

## Recommended workflow

1. Open an issue first for large features, architectural changes, or behavior changes.
2. Keep pull requests focused on one concern.
3. Add or update tests when behavior changes.
4. Update docs when public behavior, setup, or configuration changes.

## Quality bar

Run the full local check before opening a pull request:

```bash
pnpm check
```

If your change touches schema bootstrapping or migrations, also verify:

```bash
pnpm db:migrate
```

## Design expectations

- Keep the codebase TypeScript-first and Node 24 compatible.
- Prefer explicit types, small modules, and predictable state transitions.
- Preserve the separation between orchestration, external integrations, and HTTP transport.
- Do not write directly into target repositories outside the scheduler-managed workspace flow.

## Pull request checklist

- Tests added or updated when needed
- Docs updated when behavior changed
- No secrets, tokens, local paths, or generated artifacts accidentally included
- New configuration keys documented in README or config examples

## Community norms

By participating in this project, you agree to follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Contribution licensing

Unless explicitly agreed otherwise, contributions to software files are accepted under the same
PolyForm Noncommercial 1.0.0 terms used for the codebase, and contributions to documentation or
community files are accepted under the same CC BY-NC-SA 4.0 terms used for those materials.
