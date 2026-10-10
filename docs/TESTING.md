# Testing ProjectHub

All commands run from the repository root. Install with `npm ci`, then generate the client with `npm run db:generate`. Supported development/test Node lines are 22.22.2+ and 24.15.0+ (22 or 24 only); `.nvmrc` selects 22. The stricter patch floor is required by jsdom, not a statement that every production dependency has the same floor.

## Fast checks

```sh
npm run typecheck
npm test
npm run test -w @projecthub/api
npm run test -w @projecthub/web
npm run test:ops
```

The shared runner discovers `*.test.ts`, `*.test.tsx`, and JavaScript test files; `*.integration.test.*` is excluded from unit runs. API tests build first because Nest DTO/controller fixtures require TypeScript's decorator metadata. Web tests use a separate automatic-JSX/path-alias configuration. Database URLs are removed from unit-test child environments. A test directory with no matching tests fails instead of reporting success.

Pass Node test-runner options after `--`, for example:

```sh
npm run test -w @projecthub/web -- --test-name-pattern='gallery'
npm run test:ops -- --test-name-pattern='readiness'
```

jsdom interaction tests exercise React state, form behavior, URL/history handling, and mocked request races. They do not run Chromium, apply real layout, or prove screen-reader/browser compatibility.

## Disposable PostgreSQL

Install PostgreSQL 17 through an official distribution or package manager. The helper uses existing binaries and never downloads software or changes a system service. Run as a non-root user:

```sh
npm run test:db
# If binaries are outside PATH:
PG_BIN=/usr/lib/postgresql/17/bin npm run test:db
# Real production frontend plus API through the same-origin proxy:
npm run test:db -- npm run test:fullstack
```

Every invocation creates a unique temporary cluster/database and random loopback port. Authentication is trust-only for this throwaway local cluster; no real credentials or data are used. Migrations run before the requested test command. The cluster and generated uploads/runtime copies are removed on success or failure; commands have bounded timeouts and terminate their owned process groups on interruption. A forced machine shutdown can still leave temporary files that need operator inspection.

The helper needs `initdb`, `pg_ctl`, and `createdb`. It finds `PG_BIN`, PATH, `pg_config --bindir`, or common Debian installation paths. Do not start it under `NODE_ENV=production`.

## An existing isolated test database

Only loopback hosts (`127.0.0.1`, `localhost`, `::1`) and database names `projecthub_test` or `projecthub_test_<suffix>` are accepted. Connection parameters cannot override the host/database. This guard reduces accidental misuse; you must still ensure a loopback tunnel does not lead to production.

```sh
export TEST_DATABASE_URL='postgresql://test_user:LOCAL_TEST_PASSWORD@127.0.0.1:5432/projecthub_test?schema=public'
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm run test:integration
npm run test:fullstack
```

There is no fallback to the ordinary `DATABASE_URL`. An absent/unsafe test URL is a failing check, not a passing skipped suite. The integration harness uses ephemeral API ports and separate upload directories. Fixtures clean up only their own records.

## What the full-stack runner proves

`npm run test:fullstack` builds both apps, copies the exact standalone/static/public layout from `Dockerfile.web` into a temporary directory outside the checkout, and starts its generated `apps/web/server.js`. The runtime cannot silently load project development dependencies from the source checkout. The suite verifies HTML pages, referenced JavaScript/CSS and example assets, frontend security headers, API/database readiness, session cookies, authorization, real image normalization/privacy, moderation, filters, idempotent interactions, administrative audit records, hiding, and logout revocation.

The API is compiled and uses a real PostgreSQL database. The frontend server uses a production build; test requests are HTTP clients, not rendered browser interactions. Do not run concurrent builds in the same checkout because they share `.next` and API output directories.

## Security and CI

`npm run security:audit` checks the lockfile against the current npm advisory service. It rejects new findings, severity/version/path changes, expired/stale reviews, and invalid registry responses. See [dependency review](DEPENDENCY-AUDIT.md) for the remaining advisory exceptions and expiry; do not extend expiry without another review.

`.github/workflows/verify.yml` defines Node 22/24 type/unit/build checks, a PostgreSQL 17 service with migration/integration/full-stack checks, and Compose configuration/runtime checks. Action versions are pinned to verified immutable commit SHAs, checkout credentials are not persisted, and jobs have read-only repository permissions. No deployment or production secrets are involved. Checked-in workflow configuration is not evidence that a hosted CI run has passed.

Before release, use [manual QA](MANUAL-QA.md) in supported real desktop/mobile browsers and complete actual Docker/Compose, HTTPS, backup/restore, and operational checks. The latest recorded evidence and limitations are in [VALIDATION.md](VALIDATION.md).

## Hosted Docker runtime smoke

The Compose job runs `node scripts/docker-smoke.cjs` on an ephemeral GitHub-hosted Ubuntu runner with its installed Docker/Compose tools. The helper deliberately refuses ordinary local or self-hosted execution. It uses the unchanged `compose.yaml`, the existing fictional CI database password, an explicit unique project name, fresh project-scoped volumes, and one loopback web port. It ignores `.env` files and inherited remote Docker host/context settings. No registry login, new account, browser, deployment, or production credentials are needed.

The smoke builds the actual API and standalone web images and checks:

- Successful one-shot migrations and healthy PostgreSQL/API/web containers
- Proxied database readiness, HTML, and referenced immutable JavaScript/CSS assets
- Real container port bindings: only the web port is published, on loopback
- API/web non-root runtime users and init processes
- Upload-volume write permissions and persistence of an inert marker across API container recreation
- Database outage: liveness remains available, readiness fails, then readiness recovers after restart

Startup and individual commands are bounded within a 15-minute run deadline. Teardown has a separate 90-second deadline. Before removing anything, the helper inspects project/resource labels and refuses unexpected ownership; cleanup removes only its own containers, network, and disposable volumes, never a general Docker prune. Failures report bounded, credential-redacted command output and service state/health summaries. An abrupt runner termination may prevent teardown; this is why the helper is restricted to ephemeral hosted runners.

The helper's pure validation tests run with `npm run test:ops` and do not start Docker. At introduction, local helper tests and workflow/static checks passed, but **the new Docker runtime job has not yet been executed**. Publication and hosted CI execution require separate approval; configuration is not a passing runtime result. Even after a successful run, this smoke does not exercise `compose.dokploy.yaml` secret-volume initialization, ingress/HTTPS, backup restoration, or rendered-browser behavior.
