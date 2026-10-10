# Validation record

Updated 2026-10-10. This records reproducible development checkpoints, not production certification. Source work continues between checkpoints; rerun the complete gates against the exact release candidate. Commands and safety boundaries are in [TESTING.md](TESTING.md).

## Baseline and new coverage

At the restored `081db983348c76672eece7b8cd3199713bbe5c03` baseline, dependency installation, Prisma generation, and both type checks passed. API tests reported seven passes and one skipped database test. The frontend test command only performed type checking, and six deterministic credential-bootstrap tests passed.

The repository now includes explicit unit/DOM/operations runners, a fail-closed test-database URL guard, disposable PostgreSQL lifecycle tooling, the previously missing real full-stack HTTP regression suite, and CI configuration. Unit runs remove inherited database URLs; requested database runs fail rather than silently skip when their explicit test URL is absent.

## Earlier development checkpoints

- Node 24.19.0/npm 11.9.0 was used for the initial install and iterative type/unit/production-build/HTTP checks.
- Official Node 22.23.3/npm 10.9.9 was downloaded from nodejs.org and its archive SHA-256 was checked against the official release manifest. Both workspace type checks passed. The measured unit checkpoint reported **37 API, 54 frontend, and 33 operations tests passed**, zero failures/skips.
- Real PostgreSQL 17.11 was launched from official Debian distribution packages in a disposable, loopback-only cluster. Fresh migrations and **three integration tests passed**, zero skips, under Node 22. These include real API workflows, migration preservation of existing project data, and bounded concurrent session issuance.
- The production full-stack HTTP suite passed under Node 24 and Node 22. An early Node 22 checkpoint after mandatory client-version support reported **13 tests passed** (12 HTTP groups plus their parent), zero failures/skips. It built both apps, copied the exact standalone/static/public layout used by `Dockerfile.web` outside the source checkout, and ran the generated frontend server against the real compiled API and PostgreSQL.
- HTTP coverage includes 11 page routes, example images, referenced built JavaScript/CSS, frontend security headers, database readiness through the same-origin proxy, session-cookie forwarding, role boundaries, real PNG-to-WebP uploads, draft/image privacy, feedback/resubmission/approval, combined gallery filters, likes/bookmarks/daily views, role audit records, hiding, and logout revocation. Versioned mutations use the preceding response version; missing/stale editor writes and stale deletion are rejected without overwriting or deleting the current record.
- The copied frontend runtime excluded the API source and DOM-testing dependencies. Built JS/CSS requests returned successful immutable responses. A separate local `npm start`-equivalent smoke verified the standalone startup helper and public assets.
- Process cleanup regression tests cover timeouts, cancellation, a resistant same-group descendant after its wrapper exits, and a detached build that must finish cancellation before its owner exits. The PostgreSQL helper was checked on both a successful run and an intentional failing command; its temporary cluster was removed.
- `npm run security:audit` passed its explicit policy with five version/path-scoped temporary advisory exceptions. This is **not** a zero-known-vulnerability result. See [dependency review](DEPENDENCY-AUDIT.md), including the 2026-11-09 review expiry.
- Compose YAML and workflow YAML parsed locally. Official actionlint 1.7.12 validated the corrected GitHub Actions expressions and job contexts; its release archive digest was verified before use. API/web readiness configuration, read-only repository CI permissions, and immutable action pins were inspected. Subsequent hosted execution is recorded at the verified application checkpoint below.

Counts describe the checkpoints above, not a promise that later commits have the same counts. Assertions in the checked-in test files are the source of truth. Before publishing or releasing, run the full commands again after all review fixes and concurrent changes are complete.

## Browser and container limitations

A fresh installed-Chromium check on 2026-10-10 failed before page creation with `process_singleton_posix.cc: socket() failed: Operation not permitted`. The execution environment prohibits the required Unix socket. No restriction was bypassed, and **no real-browser screenshot or rendered-browser workflow passed in this local environment**.

React/jsdom tests provide useful interaction coverage, and production HTTP checks prove server/proxy workflows, but neither establishes responsive layout, visual fidelity, browser-console health, real keyboard behavior, or screen-reader accessibility. Use [manual QA](MANUAL-QA.md) in a supported desktop/mobile browser before release.

Docker is unavailable in the local execution environment. Subsequent hosted ordinary-Compose image/runtime checks are recorded below; the local standalone runtime smoke alone validates copied file layout and server behavior, not container execution. The Dokploy-specific secret initializer, credential-volume permissions, and PostgreSQL password-file/privilege-drop path remain unexecuted.

The fixture-only recovery rehearsal uses a quiescent fictional database/upload pair. It is not a production restore or a live cross-store snapshot strategy; it explicitly demonstrates that old session rows can resurrect revoked sessions. See [recovery boundaries](RECOVERY-REHEARSAL.md).

No production database, public deployment, new production credential, HTTPS configuration, production backup/restore, representative production load test, institutional privacy rollout, or full independent security audit was performed by these checks. Deployment remains a separate approval-required operation.

## Verified application checkpoint: 2026-10-10

This is the 83-commit **application checkpoint**, not a claim that the sprint is complete or that later changes are covered. The following immutable revisions contain the same application tree:

- Local checkpoint: `2669fde477b93edf5719e78aa63506b36d5ed1c2`
- Published checkpoint: `92e5b15f6401e7220a94b04b059841746ccccd2c`
- Exact-head workflow: [Verify ProjectHub, run 38063198900](https://github.com/9MidhunPM/projecthub/actions/runs/38063198900)

### Local checks

Node 24.19.0, npm 11.9.0, and PostgreSQL 17.11 were used. These commands completed successfully in sequence; set `PG_BIN` to the installed PostgreSQL 17 binary directory if discovery needs help:

```sh
npm run db:generate
npm run typecheck
npm test
npm run security:audit
npm run test:db -- npm run test:integration
npm run test:db -- npm run test:fullstack
npm run test:restore
```

Results at this checkpoint: 303 fast tests (127 API, 127 frontend, 49 operations), 26 real-database tests, 16 production-proxy tests, and 6 fixture-recovery tests passed, with zero failures or skips. The full-stack gate built both apps. Each database command used a fresh disposable cluster and removed it afterward. The audit passed with the five reviewed exceptions, not zero known advisories.

These counts identify this checkpoint only. Use the commands and test assertions, rather than these historical counts, to validate a later revision. The documentation commit recording this evidence is intentionally not its own application checkpoint.

### Hosted checks

The exact-head workflow above completed successfully, observed at **15:24 UTC on 2026-10-10**. All four jobs passed:

- Node 22 types/unit/audit/build: Node 22.23.3 and npm 10.9.9
- Node 24 types/unit/audit/build: Node 24.21.0 and npm 11.19.0
- PostgreSQL 17 migrations/integration/production-proxy regression
- Compose configuration validation and isolated Docker runtime smoke

The hosted runner was Ubuntu 24.04, image `20261004.327.1`, with Docker Compose 2.38.2. Runtime logs confirmed actual API/web image builds, successful migrations, container health, same-origin readiness/HTML/static assets, API package isolation/generated client/native image codec, non-root API/web users, upload-volume persistence, loopback-only web port publication, database-outage recovery, and project-scoped cleanup.

The Compose job parses the Dokploy configuration but executes only ordinary `compose.yaml`. It does not validate Dokploy secret initialization, credential-volume recovery, ingress/HTTPS, or behavior on the intended deployment host. The fixture recovery command is local-only and is not part of this hosted workflow. No rendered-browser or production-service check is implied by these passing jobs; the limitations above still apply.
