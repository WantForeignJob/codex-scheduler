# Codex Scheduler

[![CI](https://github.com/WantForeignJob/codex-scheduler/actions/workflows/ci.yml/badge.svg)](https://github.com/WantForeignJob/codex-scheduler/actions/workflows/ci.yml)
[![Code License](https://img.shields.io/badge/code-PolyForm%20Noncommercial%201.0.0-2f6feb)](./LICENSE-CODE)
[![Docs License](https://img.shields.io/badge/docs-CC%20BY--NC--SA%204.0-1f883d)](./LICENSE-DOCS)

Codex Scheduler is a local-first automation service for running structured coding tasks against one
or more repositories. It accepts work from APIs and Linear, prepares an isolated workspace, asks
Codex to make the code changes, runs verification commands, retries when needed, and delivers the
result as a local branch or a GitHub pull request.

This repository is set up as a public source-available project with split licensing:

- code is licensed under PolyForm Noncommercial 1.0.0
- documentation is licensed under CC BY-NC-SA 4.0

Commercial use is not allowed under the current licensing setup.

## What it does

- Accepts structured or raw tasks over a local REST API
- Polls Linear and maps issues into scheduler tasks
- Routes work across multiple repository profiles
- Uses Codex SDK for real code execution in isolated workspaces
- Runs install, test, lint, and build commands under scheduler control
- Performs repair loops when verification fails
- Blocks delivery when sensitive output is detected by Gitleaks
- Delivers local commits or GitHub pull requests

## Authentication model

The project treats Codex execution and Responses orchestration as separate layers:

- Codex execution:
  - can use `OPENAI_API_KEY`
  - can also reuse an existing local Codex / ChatGPT login state
- Responses orchestration:
  - requires `OPENAI_API_KEY`
  - falls back to local deterministic behavior when the key is not present

That means the scheduler can still run real Codex turns without `OPENAI_API_KEY`, while task
normalization, planning, and completion summaries fall back to local logic.

## Repository layout

- [src](./src): application code
- [tests](./tests): test suite
- [config/scheduler.config.toml](./config/scheduler.config.toml): sample scheduler configuration
- [AGENTS.md](./AGENTS.md): repository-specific engineering rules

## Requirements

- Node.js 24+
- pnpm 10+
- git
- gitleaks

Optional environment variables:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `LINEAR_API_KEY`
- `GITHUB_TOKEN`
- `LOG_LEVEL`

## Quick start

```bash
pnpm install
pnpm approve-builds --all
pnpm db:migrate
pnpm dev
```

The server listens on `127.0.0.1:4318` by default.

## Configuration

The committed [config/scheduler.config.toml](./config/scheduler.config.toml)
contains sample repository profiles. Replace those values before real use.

Each repository profile defines:

- execution mode: `local` or `github`
- local path or clone URL
- default branch
- install command
- verification commands
- Linear routing rules
- optional Linear status mapping

## API

- `GET /healthz`
- `POST /api/tasks`
- `GET /api/tasks/:id`
- `GET /api/tasks/:id/events`
- `POST /api/tasks/:id/cancel`
- `POST /api/tasks/:id/retry`

### Example: raw task intake

```json
{
  "repositoryId": "sample-local",
  "source": "api",
  "rawInput": "Add an empty state and basic tests to the users page"
}
```

### Example: structured task intake

```json
{
  "repositoryId": "sample-local",
  "source": "api",
  "contract": {
    "goal": "Add an empty state to the users page",
    "business_context": "Reduce confusion for first-time users",
    "scope_in": ["Add empty state UI", "Add a basic regression test"],
    "scope_out": ["Do not redesign the visual system"],
    "constraints": ["Keep existing dependencies"],
    "files_hint": ["src/pages/users"],
    "acceptance_tests": ["Show the empty state when the list is empty"],
    "delivery": ["pull_request"]
  }
}
```

## Health endpoint

`GET /healthz` returns runtime capability information, not just a boolean.

Example:

```json
{
  "ok": true,
  "auth": {
    "codex": {
      "available": true,
      "mode": "chatgpt_login",
      "binaryPresent": true,
      "authFileDetected": true
    },
    "responses": {
      "available": false,
      "mode": "local_fallback"
    }
  },
  "capabilities": {
    "code_execution": "codex",
    "workflow_orchestration": "local_fallback"
  }
}
```

## Development

Run the full local verification suite before opening a pull request:

```bash
pnpm check
```

If you change schema bootstrapping or migrations:

```bash
pnpm db:migrate
```

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before sending changes.

## Security

Please read [SECURITY.md](./SECURITY.md) before reporting a vulnerability.

## License

This repository uses split licensing:

- code and software configuration: [PolyForm Noncommercial 1.0.0](./LICENSE-CODE)
- documentation and community files: [CC BY-NC-SA 4.0](./LICENSE-DOCS)

See the overview in [LICENSE](./LICENSE).

## Notes for maintainers

- `package.json` intentionally remains `"private": true` to prevent accidental npm publication.
- Before making the repository public, review local `data/`, `reports/`, and `workspaces/` contents and
  confirm no sensitive artifacts remain on disk.
- If you later publish to npm, add final `repository`, `homepage`, and `bugs` fields to `package.json`.
