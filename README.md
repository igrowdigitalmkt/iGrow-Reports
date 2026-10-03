# iGrow Reports

iGrow Reports is an open-source, multi-tenant platform for advertising analytics, reporting, and client-facing dashboards.

The project is being built for agencies, independent media buyers, and companies that manage paid media internally and need a clearer way to consolidate advertising data, organize clients, generate reports, and give stakeholders controlled access to performance information.

> **Project status:** early public release and under active development. The repository is maintained continuously, but public adoption is still at an early stage.

## Why iGrow Reports

Advertising data is often fragmented across platforms, accounts, spreadsheets, dashboards, and manual reports. iGrow Reports aims to provide an extensible open-source foundation for bringing those workflows together while keeping tenant isolation, auditability, and maintainability as first-class concerns.

## Current scope

The repository currently includes:

- Multi-tenant organization and client structure
- Supabase authentication and PostgreSQL persistence
- Row Level Security policies and database isolation tests
- Client-facing authenticated area
- Dashboard and campaign reporting foundations
- Filtering by period, platform, account, and campaign
- Report management foundations
- Meta Ads integration work and synchronization flows
- Demo routes with clearly identified fictional data
- Automated linting, type checking, unit tests, database tests, builds, and browser tests
- Architecture, database, metrics, integration, and deployment documentation

The product interface is currently primarily in Portuguese. Contributions that improve internationalization are welcome.

## Tech stack

- Next.js 16
- React 19
- TypeScript 6
- Supabase / PostgreSQL
- ECharts
- Tailwind CSS
- Vitest
- Playwright
- pnpm

## Run locally

### Requirements

- Node.js 24
- pnpm 11.19

Clone the repository and install dependencies:

```bash
git clone https://github.com/igrowdigitalmkt/iGrow-Reports.git
cd iGrow-Reports
pnpm install --frozen-lockfile
```

Create your local environment file from the example:

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Then start the development server:

```bash
pnpm dev
```

Open `http://localhost:3000/demo` to inspect the demo experience without production credentials.

For authenticated flows, configure Supabase according to [docs/BANCO.md](docs/BANCO.md).

## Environment variables and secrets

Never commit production credentials, API tokens, service-role keys, encryption keys, or webhook secrets.

The repository tracks only `.env.example`. Local and production environment files are ignored by Git.

See [docs/INTEGRACOES.md](docs/INTEGRACOES.md) and [docs/OPERACAO.md](docs/OPERACAO.md) for integration and deployment guidance.

## Quality checks

Run the complete local verification suite with:

```bash
pnpm check
```

Or run checks individually:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
```

Browser tests use Playwright:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

GitHub Actions runs the repository quality workflow on pushes and pull requests.

## Repository documentation

- [V1 planning](docs/PLANEJAMENTO_V1.md)
- [Implementation progress](docs/IMPLEMENTACAO.md)
- [Architecture and security boundaries](docs/ARQUITETURA.md)
- [Database, bootstrap, and SQL tests](docs/BANCO.md)
- [Metric definitions](docs/METRICAS.md)
- [Integration configuration](docs/INTEGRACOES.md)
- [Operations and deployment](docs/OPERACAO.md)
- [Client Area foundation](docs/AREA_CLIENTE.md)

## Contributing

Contributions are welcome.

Before opening a pull request, read [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports, documentation improvements, tests, integration work, accessibility improvements, and well-scoped feature proposals are all useful contributions.

If you want to work on a larger change, open an issue first so the implementation direction can be discussed before significant work begins.

## Security

Please do not disclose vulnerabilities in public issues.

Read [SECURITY.md](SECURITY.md) for the responsible disclosure process.

## License

iGrow Reports is licensed under the [Apache License 2.0](LICENSE).
