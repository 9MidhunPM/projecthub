# Validation record

Build preparation dated 2026-10-09. Status here records checks actually reported during this build, not a production certification. Re-run checks after edits.

## Completed

- Root npm workspace install: succeeded; 228 packages installed and `package-lock.json` generated.
- Backend TypeScript build and type check: passed.
- Backend automated tests: 4 passed, 0 skipped, against a real PostgreSQL 17.6 process in the isolated build environment.
- Integration coverage includes signup, ownership, origin protection, upload byte validation and private-image visibility, moderation/publication, feedback, role restrictions, unsafe URL rejection, foreign-upload rejection, idempotent likes/bookmarks, per-day view de-duplication, and logout revocation. Assertions are the source of truth; see `apps/api/test/`.
- Root `package.json` / lockfile JSON and Compose YAML parsed successfully.
- All six seeded screenshot example paths exist in `apps/web/public/examples/`.

The isolated runner provided Node.js 24.19.0; container recipes target Node.js 22 LTS. PostgreSQL was launched from a registry-distributed embedded PostgreSQL package solely for testing, outside this source distribution. Deployment uses the official PostgreSQL Compose image.

## Pending / not established by this record

- Frontend browser interaction, responsive rendering, accessibility, visual fidelity, and browser console checks remain unverified due to the browser execution restrictions described below.
- Docker image builds and Compose startup: not run; Docker was unavailable in the build environment.
- Dokploy deployment, public HTTPS, production volumes, backups/restores, live email/SSO, load testing, and a security audit: not performed.

The manual checklist is a repeatable acceptance procedure, not evidence that all its items passed. Frontend `npm test` is TypeScript checking, not an automated browser suite. API integration tests skip without `DATABASE_URL`; this build's reported database-backed run did not skip them.

## Fullstack HTTP acceptance run

Completed 2026-10-09 against a fresh real PostgreSQL database, migrated and seeded, compiled NestJS API, and Next.js development server. Requests used the real same-origin Next proxy at `http://localhost:3000`, including browser-equivalent Origin and session cookies. **13 test groups passed; 0 failed.**

- All 11 exercised Next routes returned valid ProjectHub HTML without compilation-error documents.
- Gallery listing, free-text search, department/semester/type/technology filters, popularity sort, pagination, empty results, and all seeded screenshot assets.
- Student login, logout, session revocation, bookmarks, likes/unlikes, collection persistence, and profile updates.
- Invalid self-role escalation rejected; new signup creates only student accounts and rejects a forged admin field.
- Real PNG upload normalized to WebP, project draft creation/editing, and draft submission.
- Anonymous users and unrelated students cannot access private draft details or uploaded screenshots; unrelated students cannot edit another owner's project.
- Faculty request changes with mandatory feedback; student sees feedback and resubmits; faculty approval makes both project and screenshot public.
- Student/faculty administrative restrictions, admin role changes, self-demotion prevention, and corresponding audit records.
- Hiding an approved project removes it from public results and protects its uploaded screenshot again.

Frontend production build and TypeScript check were separately reported successful by the frontend implementation worker.

## Browser execution limitation

A comprehensive desktop/mobile Playwright workflow was prepared, but **no browser workflow passed and no rendered screenshots were captured**. Installed Chromium failed before page creation because the environment prohibited a required local Unix socket (`process_singleton_posix.cc: socket() failed: Operation not permitted`). Reviewed elevated execution produced the same failure. The supported cloud browser could not reach the isolated server (`ERR_CONNECTION_REFUSED`); recovery was then rejected by its URL policy. These restrictions were not bypassed. No Firefox or headless-shell alternative was installed.

Consequently, HTTP checks prove application routes and server workflows, not client-side interaction correctness, responsive layout, absence of browser-console errors, or fidelity to the concept images. The concept images are design references, not screenshots of the running product. Run the manual acceptance checklist in a supported local browser before release.

## Deployment credential bootstrap checks

- `node --check` passed for both container-side credential scripts.
- `node --test docker/secret-bootstrap.test.cjs`: 6 passed, 0 failed, using deterministic in-memory fixtures. No actual database credential was generated during these tests.
- Dedicated Dokploy Compose YAML parsed; five services, no host ports, required initialization/migration dependency gates, read-only secret consumers, and absence of credential values in configuration were checked.
- Actual container execution, UID ownership behavior, and approved public deployment remain runtime checks; mocked tests do not establish those outcomes.
