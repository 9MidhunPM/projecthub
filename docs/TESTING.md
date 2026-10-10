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

## Uploader process-crash regression

On Unix, `npm run test:integration` includes `apps/api/test/upload-crashes.integration.test.ts`. It starts owned, loopback-only API children against a unique migrated test schema and temporary upload directory. Test-only wrappers pause at three real persisted-state boundaries: committed PENDING reservation before file creation, a partial file write, and committed READY state before the HTTP response. The parent verifies that state independently, then sends `SIGKILL` only to its uploader child, bypassing normal exception/finally cleanup.

A fresh API child without the crash wrappers verifies that quota charges persist, PENDING uploads remain unreadable/unattachable, READY uploads retain authorized access, further uploads are rejected at the limit, and an unrelated sentinel file/record remains unchanged. PostgreSQL and the operating system stay alive. This does not simulate host/power loss, prove filesystem `fsync` durability, or enumerate every native write boundary. Production code has no crash flags or failpoints.

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

`npm run test:fullstack` builds both apps, copies the exact standalone/static/public layout from `Dockerfile.web` into a temporary directory outside the checkout, and starts its generated `apps/web/server.js`. The runtime cannot silently load project development dependencies from the source checkout. The suite verifies HTML pages, referenced JavaScript/CSS and example assets, frontend security headers, API/database readiness, session cookies, authorization, real image normalization/privacy, versioned mutations and stale-write rejection, moderation, filters, paginated collection traversal and administrator search reachability, idempotent interactions, administrative audit records, hiding, and logout revocation.

The API is compiled and uses a real PostgreSQL database. Both synthetic HTTP harnesses (full-stack and recovery) explicitly bind the API to loopback and verify its actual listening address. The frontend server uses a production build; test requests are HTTP clients, not rendered browser interactions. Do not run concurrent builds in the same checkout because they share `.next` and API output directories.

## Security and CI

`npm run security:audit` checks the lockfile against the current npm advisory service. It rejects new findings, severity/version/path changes, expired/stale reviews, and invalid registry responses. See [dependency review](DEPENDENCY-AUDIT.md) for the remaining advisory exceptions and expiry; do not extend expiry without another review.

`.github/workflows/verify.yml` defines Node 22/24 type/unit/build checks, a PostgreSQL 17 service with migration/integration/full-stack checks, ordinary Compose configuration/runtime checks, and a separate isolated credential-recipe job. Action versions are pinned to verified immutable commit SHAs, checkout credentials are not persisted, and jobs have read-only repository permissions. No deployment or production secrets are involved. Checked-in workflow configuration is not evidence that a hosted CI run has passed.

Before release, rerun the gates against the intended revision, use [manual QA](MANUAL-QA.md) in supported real desktop/mobile browsers, and complete deployment-specific HTTPS, backup/restore, and operational checks. The ordinary Compose and credential-recipe jobs have distinct scopes. The dated [application checkpoint](VALIDATION.md#verified-application-checkpoint-2026-10-10) and [later recipe/crash-test checkpoint](VALIDATION.md#verified-container-and-crash-test-checkpoint-2026-10-10) separate completed checks from remaining gaps.

## Hosted Docker runtime smoke

The Compose job runs `node scripts/docker-smoke.cjs` on an ephemeral GitHub-hosted Ubuntu runner with its installed Docker/Compose tools. The helper deliberately refuses ordinary local or self-hosted execution. It uses the unchanged `compose.yaml`, the existing fictional CI database password, an explicit unique project name, fresh project-scoped volumes, and one loopback web port. It ignores `.env` files and inherited remote Docker host/context settings. No registry login, new account, browser, deployment, or production credentials are needed.

The smoke builds the actual API and standalone web images and checks:

- Successful one-shot migrations and healthy PostgreSQL/API/web containers
- Proxied database readiness, HTML, and referenced immutable JavaScript/CSS assets
- Real container port bindings: only the web port is published, on loopback
- API/web non-root runtime users and init processes
- API-only dependency isolation, retained Prisma/tsx tooling, generated Prisma Client, and a native sharp WebP round trip
- Upload-volume write permissions and persistence of an inert marker across API container recreation
- Database outage: liveness remains available, readiness fails, then readiness recovers after restart

Startup and individual commands are bounded within a 15-minute run deadline. Teardown has a separate 90-second deadline. Before removing anything, the helper inspects project/resource labels and refuses unexpected ownership; cleanup removes only its own containers, network, and disposable volumes, never a general Docker prune. Failures report bounded, credential-redacted command output and service state/health summaries. An abrupt runner termination may prevent teardown; this is why the helper is restricted to ephemeral hosted runners.

The helper's pure validation tests run with `npm run test:ops` and do not start Docker. Completed hosted execution is recorded at the [verified application checkpoint](VALIDATION.md#verified-application-checkpoint-2026-10-10); local helper tests or workflow configuration alone are not runtime evidence. The smoke does not exercise `compose.dokploy.yaml` secret-volume initialization, ingress/HTTPS, backup restoration, or rendered-browser behavior. Publication and hosted CI execution remain separate approval-required actions.

## Hosted credential-recipe smoke

The separate `credential-recipe` job invokes `node scripts/dokploy-smoke.cjs` on an ephemeral GitHub-hosted runner. It uses the unchanged `compose.dokploy.yaml` under a unique test project, with fresh `postgres_data`, `uploads`, and `db_credentials` volumes. It publishes **no host ports** and probes services through container commands. The fixed HTTPS origin in the recipe is configuration only: the test never contacts Dokploy, resolves the public application domain, configures ingress, or deploys anything. Images are built locally on the disposable runner and are not pushed to a registry.

The helper verifies:

- The real secret initializer and migration job succeed; PostgreSQL/API/web become healthy
- Root-owned, group-1000 credential-file permissions, UID-1000 API/migration readability, and read-only credential mounts
- Real database authentication over the private network, with an explicitly wrong password rejected as an authentication failure
- All PostgreSQL PID-1 UID fields reflect the non-root postgres account
- Internal frontend-proxy readiness and a real gallery query, without giving the web service a credential mount
- Credential preservation across repeated initialization and DB/API container recreation
- After all original services stop, moving only the synthetic credential aside causes the real initializer to refuse the initialized database, without generating a replacement or pending file; a Docker launch failure alone cannot satisfy this check

Generated credentials and comparison fingerprints stay inside the disposable fixture; none are supplied through Docker arguments, copied out, cached, uploaded, or placed in image layers. The fixture file is moved only inside its own credential volume for the final negative case. Cleanup removes that volume together with the other test resources. Runtime output is discarded except a fixed success token from probes. Failure reports contain only fixed stage names and allowlisted service/status/exit/health fields; they intentionally omit raw runtime logs, environment dumps, and exception values.

Safety checks reject non-hosted execution, remote Docker settings, inherited Compose/builder overrides, host publishing, bind mounts, external volumes/networks, unexpected build contexts, and changed credential wiring. Every Docker command uses the local Unix socket with a fresh private home/client/buildx configuration and the default builder; no existing registry credentials, proxy configuration, or selected builder are copied. Cleanup inspects both project-labeled resources and exact configured volume/network names, refusing foreign or missing ownership labels before removal. It never runs a general prune. The helper has a 15-minute execution deadline and a separate 90-second cleanup budget inside a dedicated 20-minute job. Its temporary CLI configuration is also removed. Hard runner termination can still prevent cleanup; this is not suitable for a persistent/self-hosted machine.

This exact recipe passed its isolated hosted lifecycle on 2026-10-10 at the [89-commit checkpoint](VALIDATION.md#verified-container-and-crash-test-checkpoint-2026-10-10), including scoped cleanup. Its pure helper tests also run with `npm run test:ops` and create no credentials or Docker resources. The hosted result does not establish real Dokploy network rewriting, public HTTPS/cookie behavior, automatic deployment, production-host capacity, credential-volume restoration, rotation, or disaster recovery. Rerun against the intended revision and complete approved platform-specific staging checks before production use.

## Local fixture recovery rehearsal

With the PostgreSQL 17 tools installed, including `pg_dump` and `pg_restore`, run `npm run test:restore`. It creates its own disposable cluster, unique source/target databases, fictional application/session/upload data, and private temporary files; performs a real logical dump/restore; then checks the restored API, metadata, checksums, and deliberate missing/corrupt upload cases. The source database and upload files are quiescent during capture. There is no user archive/path input, production connection fallback, or hosted CI wiring.

See [recovery rehearsal](RECOVERY-REHEARSAL.md) for exact acceptance and limitations, especially the demonstrated risk that restoring old session rows can resurrect sessions revoked after capture. This is test coverage, not an operator backup/restore tool or proof of a live cross-store snapshot strategy.
