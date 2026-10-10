# ProjectHub

A college project showcase: students submit work, faculty review it, and visitors discover approved projects. Next.js frontend, NestJS API, Prisma, and PostgreSQL. The included content and accounts are fictional demonstration data.

## What's included

- Responsive public gallery, search, department/semester/type/technology filters, project details
- Student signup/login/profile, project drafts, editing, submission, screenshot uploads
- Persistent likes, bookmarks, and per-visitor daily view de-duplication
- Faculty moderation, feedback, approval, request changes, hiding
- Admin role management and audit history
- Session-cookie authentication, ownership checks, server validation, image re-encoding

This is a runnable MVP, not an institutional production rollout. Email verification, password reset, SSO, collaborative editing, milestone tracking, notifications, and institution-specific student privacy policies are not implemented. Team members are project metadata, not co-editors. See [architecture](docs/ARCHITECTURE.md) and [QA checklist](docs/MANUAL-QA.md).

## Prerequisites

For development and tests: Node.js 22.22.2+ on the 22 LTS line, or 24.15.0+ on the 24 LTS line; npm 10+; PostgreSQL 17; and optionally Docker Compose v2. The minimum Node patch versions come from the pinned DOM-testing tools, not every production dependency. `.nvmrc` selects the current Node 22 line. The container recipes use `node:22-bookworm-slim`, which resolves the current 22.x image at build time. Run commands from the repository root unless noted.

## Local development

1. Install dependencies and generate Prisma Client:

   ```sh
   npm ci
   npm run db:generate
   ```

2. Copy `.env.example` to `.env`. Replace `POSTGRES_PASSWORD` with a URL-safe random value; match it in `DATABASE_URL`. Start the database only:

   ```sh
   docker compose -f compose.yaml -f compose.dev.yaml up -d db
   ```

   You may instead use an existing local PostgreSQL database named `projecthub`. Docker is not required if PostgreSQL is already installed. The dev override publishes PostgreSQL on loopback only.

3. Create `apps/api/.env` with your `DATABASE_URL` for Prisma CLI. Export that same URL in the shell for the running NestJS app, which does not load dotenv automatically:

   ```sh
   export DATABASE_URL='postgresql://projecthub:YOUR_PASSWORD@localhost:5432/projecthub?schema=public'
   export WEB_ORIGIN='http://localhost:3000'
   npm run db:migrate
   ```

4. Optional fictional demo data, on a development database only:

   ```sh
   export DEV_SEED=true
   export DEV_SEED_PASSWORD='choose-your-own-demo-password'
   npm run db:seed
   ```

   Use that password for `student@projecthub.test`, `faculty@projecthub.test`, and `admin@projecthub.test`. Seed refuses `NODE_ENV=production`. Never seed public/live databases or reuse a real password. See seed implementation for the latest fictional project data.

5. Start both apps:

   ```sh
   npm run dev
   ```

   Open http://localhost:3000. API health: http://localhost:4000/api/health. Browser requests use same-origin `/api`; Next.js proxies to port 4000. `API_INTERNAL_URL` overrides the server-side proxy destination and is baked into production rewrites at build time. Configure it before building.

   Leave a shared shell `PORT` unset when starting both apps: the API defaults to 4000 and Next defaults to 3000. Exporting `PORT=4000` for both would make them compete for one port. Database-aware readiness is available at `/api/health/ready`, directly or through the frontend proxy. The development servers bind all interfaces; use them only in a trusted development environment. This differs from the loopback-only test harnesses and local production frontend preview.

### Production-style local containers

After setting `.env`:

```sh
docker compose up --build -d
docker compose logs -f api web
```

The `migrate` job applies checked-in migrations before API startup. Only the web service is published on loopback; API and PostgreSQL remain private to Compose. PostgreSQL and images use named volumes. Compose does not seed by default. To seed an isolated local demo only:

```sh
docker compose run --rm -e NODE_ENV=development -e DEV_SEED=true -e DEV_SEED_PASSWORD='choose-your-own-demo-password' api npm run db:seed
```

Stop with `docker compose down`; this retains named-volume data. Do not add `--volumes` unless you intend to permanently remove local data.

## Verification

See [validation record](docs/VALIDATION.md) for completed checks and explicit limitations.

```sh
npm run typecheck
npm test
npm run build
npm run security:audit
```

`npm test` runs API unit tests, frontend helper/DOM interaction tests, and operations/script tests. It deliberately removes inherited database URLs from unit-test children. Type checking is a separate command. DOM tests use jsdom and do not establish actual browser rendering, layout, or keyboard accessibility.

With PostgreSQL's `initdb`, `pg_ctl`, and `createdb` installed, run a fully disposable database suite as a non-root user:

```sh
npm run test:db
npm run test:db -- npm run test:fullstack
```

Set `PG_BIN` to PostgreSQL's binary directory if it is not detected, for example `/usr/lib/postgresql/17/bin`. Each invocation initializes its own temporary, loopback-only database, applies checked-in migrations, runs the command, then stops and removes the cluster. The full-stack command builds and runs the same standalone frontend layout used by `Dockerfile.web`, checks real HTTP routes and the same-origin API proxy, and removes its test accounts/uploads. Do not run concurrent web builds in the same checkout.

To use an existing **isolated local test database**, explicitly set `TEST_DATABASE_URL` with a database named `projecthub_test` or `projecthub_test_<suffix>`, migrate that database, and run `npm run test:integration` or `npm run test:fullstack`. These commands fail without the explicit test URL; they never fall back to `DATABASE_URL`, and reject non-loopback hosts or production mode. Never point mutating tests at production. See [testing guide](docs/TESTING.md) and [manual QA](docs/MANUAL-QA.md).

For the fixture-only recovery rehearsal, also install PostgreSQL 17's `pg_dump` and `pg_restore`, then run `npm run test:restore`. It creates and restores its own fictional database/upload pair; it accepts no production backup input. See [recovery acceptance and limitations](docs/RECOVERY-REHEARSAL.md), including the risk of resurrecting revoked sessions from old backups.

The audit gate permits only the exact temporary, reviewed exceptions in [dependency review](docs/DEPENDENCY-AUDIT.md). A passing policy check is not a zero-vulnerability claim.

### Local production frontend preview

Build with the intended `API_INTERNAL_URL`, then run `npm run start -w @projecthub/web`. This prepares public/static assets beside the generated standalone server and listens on loopback port 3000 by default (`WEB_HOST` and `WEB_PORT` override it). Start the compiled API separately with its local database and matching `WEB_ORIGIN`. Changing the API destination requires rebuilding the frontend.

## Project layout

```
apps/api/                NestJS API, authorization, Prisma, tests
apps/web/                Next.js App Router UI and same-origin proxy
Dockerfile.api           API image with migration tooling
Dockerfile.web           Frontend build/runtime image
compose.yaml             Private DB/API, migration job, web, volumes
compose.dev.yaml         Optional loopback DB access for local Node development
compose.dokploy.yaml     Approved-domain HTTPS configuration for Dokploy
docs/ARCHITECTURE.md      Data model, trust boundaries, tradeoffs
docs/MANUAL-QA.md         Repeatable acceptance checklist
docs/TESTING.md           Unit, database, HTTP, and CI verification commands
docs/DOKPLOY.md           Deployment preparation, no deployment performed
```

API endpoints and request/response contracts: [apps/api/API-CONTRACT.md](apps/api/API-CONTRACT.md).

## Security and operations notes

Signups always create students. Faculty/admin privileges require an existing administrator. Session tokens are random; only hashes are stored. Cookies are HTTP-only and same-site Lax; production defaults to secure cookies, with an explicit insecure-cookie exception only for loopback HTTP development. Mutating API requests require the exact configured `Origin`; command-line API examples must send it explicitly. Uploaded screenshots are untrusted input and re-encoded by the API. Public approved project metadata excludes account email addresses, but submitted team-member text and screenshots are public content. Review student consent and privacy requirements before publication, especially for minors.

Set `WEB_ORIGIN` to the exact public HTTPS origin and `COOKIE_SECURE=true` before any approved deployment. Keep secrets outside source control, persist `postgres_data` and `uploads` (plus `db_credentials` for the Dokploy recipe), define retention/backups, and test restore. Do not expose PostgreSQL or the API publicly without a reviewed operational reason. Current rate limiting is process-local; multi-instance deployments need a shared limiter. The app has no email verification or self-service recovery, so production identity/account-recovery decisions remain open.

Upload quotas charge stored files and incomplete reservations per account; they do not cap total installation storage or provide automatic retention. Before upgrading existing data, follow the coordinated migration and legacy-size cautions in [upload storage operations](docs/UPLOAD-STORAGE.md).

Deployment is a separate, approval-required action. [Dokploy preparation](docs/DOKPLOY.md) describes a path; it does not imply this app has been deployed.

Proxy trust is intentionally unset in the demo: requests through Next share its server-side IP for rate limiting. Do not enable `TRUST_PROXY_IPS` until an ingress proxy reliably overwrites client-supplied forwarding headers; trusted IP configuration alone is insufficient.

The `projecthub.midhunpm.in` configuration uses `compose.dokploy.yaml` in Dokploy Compose mode with Isolated Deployments enabled. It publishes no host ports, fixes the HTTPS origin/secure cookies, creates a server-local cryptographic database password once in a private persistent volume, and routes only the web service through Dokploy Domains. Configuration in this repository does not authorize a deployment. See the deployment guide and obtain approval before running it.
