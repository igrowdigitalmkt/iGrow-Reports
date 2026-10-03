# Contributing to iGrow Reports

Thanks for your interest in contributing to iGrow Reports.

The project is in active development, so small, focused pull requests are preferred. Contributions can include bug fixes, tests, documentation, accessibility improvements, integration work, developer tooling, and well-scoped features.

## Before you start

1. Search existing issues before opening a new one.
2. For substantial changes, open an issue first and describe the problem you want to solve.
3. Keep pull requests focused on one concern whenever possible.
4. Never include real client data, production credentials, tokens, or secrets in issues, commits, screenshots, fixtures, or tests.

## Development setup

Requirements:

- Node.js 24
- pnpm 11.19

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

Create a local environment file:

```bash
cp .env.example .env.local
```

Then start the application:

```bash
pnpm dev
```

## Quality checks

Before submitting a pull request, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
```

For changes that affect browser behavior, also run:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

## Pull requests

A good pull request should:

- Explain the problem being solved
- Describe the approach taken
- Mention relevant issues
- Include tests when behavior changes
- Update documentation when configuration or behavior changes
- Avoid unrelated formatting or refactoring
- Pass the repository quality checks

Maintainers may request changes before merging.

## Database and multi-tenant changes

Changes involving Supabase, PostgreSQL, authentication, permissions, or tenant boundaries require extra care.

When changing database behavior:

- Add or update migrations instead of editing production state manually
- Preserve organization and client isolation
- Review Row Level Security policies
- Add or update database tests
- Avoid using privileged keys in browser code

See [docs/ARQUITETURA.md](docs/ARQUITETURA.md) and [docs/BANCO.md](docs/BANCO.md).

## Integrations

Provider integrations should keep credentials server-side and avoid coupling provider-specific behavior to shared reporting logic whenever possible.

New providers should include:

- Configuration documentation
- Error handling
- Rate-limit considerations
- Tests for transformations and edge cases
- Clear handling of unavailable or partial data

## Reporting security issues

Do not open a public issue for a vulnerability.

Follow the instructions in [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0 used by this repository.
