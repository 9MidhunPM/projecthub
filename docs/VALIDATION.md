# Validation record

Updated 2026-10-10. This records reproducible development checkpoints, not production certification. Source work continues between checkpoints; rerun the complete gates against the exact release candidate. Commands and safety boundaries are in [TESTING.md](TESTING.md).

## Baseline and new coverage

At the restored `081db983348c76672eece7b8cd3199713bbe5c03` baseline, dependency installation, Prisma generation, and both type checks passed. API tests reported seven passes and one skipped database test. The frontend test command only performed type checking, and six deterministic credential-bootstrap tests passed.

The repository now includes explicit unit/DOM/operations runners, a fail-closed test-database URL guard, disposable PostgreSQL lifecycle tooling, the previously missing real full-stack HTTP regression suite, and CI configuration. Unit runs remove inherited database URLs; requested database runs fail rather than silently skip when their explicit test URL is absent.

## Completed development checkpoints

- Node 24.19.0/npm 11.9.0 was used for the initial install and iterative type/unit/production-build/HTTP checks.
- Official Node 22.23.3/npm 10.9.9 was downloaded from nodejs.org and its archive SHA-256 was checked against the official release manifest. Both workspace type checks passed. The measured unit checkpoint reported **37 API, 54 frontend, and 33 operations tests passed**, zero failures/skips.
- Real PostgreSQL 17.11 was launched from official Debian distribution packages in a disposable, loopback-only cluster. Fresh migrations and **three integration tests passed**, zero skips, under Node 22. These include real API workflows, migration preservation of existing project data, and bounded concurrent session issuance.
- The production full-stack HTTP suite passed under Node 24 and Node 22. The latest Node 22 checkpoint after mandatory client-version support reported **13 tests passed** (12 HTTP groups plus their parent), zero failures/skips. It built both apps, copied the exact standalone/static/public layout used by `Dockerfile.web` outside the source checkout, and ran the generated frontend server against the real compiled API and PostgreSQL.
- HTTP coverage includes 11 page routes, example images, referenced built JavaScript/CSS, frontend security headers, database readiness through the same-origin proxy, session-cookie forwarding, role boundaries, real PNG-to-WebP uploads, draft/image privacy, feedback/resubmission/approval, combined gallery filters, likes/bookmarks/daily views, role audit records, hiding, and logout revocation. Versioned mutations use the preceding response version; missing/stale editor writes and stale deletion are rejected without overwriting or deleting the current record.
- The copied frontend runtime excluded the API source and DOM-testing dependencies. Built JS/CSS requests returned successful immutable responses. A separate local `npm start`-equivalent smoke verified the standalone startup helper and public assets.
- Process cleanup regression tests cover timeouts, cancellation, a resistant same-group descendant after its wrapper exits, and a detached build that must finish cancellation before its owner exits. The PostgreSQL helper was checked on both a successful run and an intentional failing command; its temporary cluster was removed.
- `npm run security:audit` passed its explicit policy with five version/path-scoped temporary advisory exceptions. This is **not** a zero-known-vulnerability result. See [dependency review](DEPENDENCY-AUDIT.md), including the 2026-11-09 review expiry.
- Compose YAML and workflow YAML parsed locally. Official actionlint 1.7.12 validated the corrected GitHub Actions expressions and job contexts; its release archive digest was verified before use. API/web readiness configuration, read-only repository CI permissions, and immutable action pins were inspected. Hosted CI execution remains a separate check after publication.

Counts describe the checkpoints above, not a promise that later commits have the same counts. Assertions in the checked-in test files are the source of truth. Before publishing or releasing, run the full commands again after all review fixes and concurrent changes are complete.

## Browser and container limitations

A fresh installed-Chromium check on 2026-10-10 failed before page creation with `process_singleton_posix.cc: socket() failed: Operation not permitted`. The execution environment prohibits the required Unix socket. No restriction was bypassed, and **no real-browser screenshot or rendered-browser workflow passed in this local environment**.

React/jsdom tests provide useful interaction coverage, and production HTTP checks prove server/proxy workflows, but neither establishes responsive layout, visual fidelity, browser-console health, real keyboard behavior, or screen-reader accessibility. Use [manual QA](MANUAL-QA.md) in a supported desktop/mobile browser before release.

Docker was unavailable. Actual image builds, Compose startup, container UID/volume ownership, and PostgreSQL entrypoint privilege-drop behavior were not executed here. The standalone runtime smoke validates the copied file layout and server behavior, not container execution.

No production database, public deployment, new production credential, HTTPS configuration, backup/restore, load test, institutional privacy rollout, or full independent security audit was performed by these checks. Deployment remains a separate approval-required operation.
