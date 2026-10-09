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

Node.js 22 LTS, npm 10+, PostgreSQL 17, and optionally Docker Compose v2. `.nvmrc` records Node 22. Run commands from the repository root unless noted.

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
   export PORT=4000
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
```

Set `DATABASE_URL` to an isolated migrated test database to include the API integration test; without it, that test is explicitly skipped. The test starts its own compiled API on port 4017 and cleans up its records. `npm test` builds the API and runs backend tests; the frontend `test` script currently performs TypeScript checking, not UI interaction tests. Never point mutating tests at production. Consult [manual QA](docs/MANUAL-QA.md) for full browser and role coverage; build success alone does not establish functional correctness.

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
docs/DOKPLOY.md           Deployment preparation, no deployment performed
```

API endpoints and request/response contracts: [apps/api/API-CONTRACT.md](apps/api/API-CONTRACT.md).

## Security and operations notes

Signups always create students. Faculty/admin privileges require an existing administrator. Session tokens are random; only hashes are stored. Cookies are HTTP-only, same-site Lax, and secure in production. Mutating API requests require the exact configured `Origin`; command-line API examples must send it explicitly. Uploaded screenshots are untrusted input and re-encoded by the API. Public approved project metadata excludes account email addresses, but submitted team-member text and screenshots are public content. Review student consent and privacy requirements before publication, especially for minors.

Set `WEB_ORIGIN` to the exact public HTTPS origin and `COOKIE_SECURE=true` before any approved deployment. Keep secrets outside source control, persist both volumes, define retention/backups, and test restore. Do not expose PostgreSQL or the API publicly without a reviewed operational reason. Current rate limiting is process-local; multi-instance deployments need a shared limiter. The app has no email verification or self-service recovery, so production identity/account-recovery decisions remain open.

Deployment is a separate, approval-required action. [Dokploy preparation](docs/DOKPLOY.md) describes a path; it does not imply this app has been deployed.

Proxy trust is intentionally unset in the demo: requests through Next share its server-side IP for rate limiting. Do not enable `TRUST_PROXY_IPS` until an ingress proxy reliably overwrites client-supplied forwarding headers; trusted IP configuration alone is insufficient.

For the approved `projecthub.midhunpm.in` deployment, use `compose.dokploy.yaml` in Dokploy Compose mode with Isolated Deployments enabled. It publishes no host ports, fixes the HTTPS origin/secure cookies, creates a server-local cryptographic database password once in a private persistent volume, and routes only the web service through Dokploy Domains. See the deployment guide before running it.
