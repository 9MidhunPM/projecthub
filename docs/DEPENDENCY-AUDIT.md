# Dependency security review — 2026-10-10

## Decision

The known request-reachable native image-parser findings are addressed by sharp 0.35.5, an input-signature check before native parsing, and an explicit native loader allowlist for PNG/JPEG/WebP buffers. This is a scoped dependency review, not proof that the complete application is vulnerability-free.

## Remediated

- **sharp 0.34.5 → 0.35.5.** The API previously passed arbitrary authenticated upload bytes to `metadata()` before rejecting unsupported formats. This reached unnecessary native parsers. Next.js 15.5.27 also accepts the patched shared sharp version. Patched versions: 0.35.0 for [libvips advisories](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), 0.35.4 for [libheif advisories](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), and 0.35.5 for [librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). The last advisory describes possible RCE under particular glibc runtime conditions; no exploit was attempted. The fix removes this known vulnerable version and blocks unsupported loaders before parsing.
- **shell-quote 1.8.3 → 1.12.0**, using a scoped override under concurrently 9.2.1. This is a same-major dependency update. The critical [command-injection advisory](https://github.com/advisories/GHSA-w7jw-789q-3m8p) affects `quote()` through 1.8.3; the [quadratic parsing advisory](https://github.com/advisories/GHSA-395f-4hp3-45gv) is patched in 1.9.0. Application production start commands do not invoke concurrently; its only usage is the trusted developer command line. Both are nevertheless removed from the installed dependency tree.

## Residual audit entries: no request-reachable path identified

The audit after remediation reports five affected package entries: four high and one moderate, zero critical. These are propagated package counts, not five distinct remotely exploitable flaws.

- **deepmerge-ts 7.1.5**, through `@prisma/config` and Prisma CLI 6.19.3. [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) requires merging cyclic JavaScript object graphs; ordinary JSON cannot create those cycles. In the installed Prisma code the import is used by trusted TypeScript/JavaScript configuration loading. No application HTTP request is passed into this configuration loader. Prisma migration/generation tools operate on operator-controlled source. The upstream fixed version is 8.0.0, a major version, so no forced transitive major update was applied.
- **PostCSS 8.4.31**, nested under Next.js 15.5.27. The application compiles repository-controlled CSS during the build; it does not accept CSS or sourcemaps from users. The [stringification XSS](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) is patched at 8.5.10. Source-map loading advisories are [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849), and [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp); the latest affected range ends at 8.5.22. The root PostCSS is already 8.5.29, but Next pins its nested copy. A non-effective override was removed rather than presenting it as a repair. Revisit through a verified compatible Next.js dependency update.

The API container recipe still retains build dependencies for migration/seed tooling. The frontend now copies Next's traced standalone runtime rather than the complete workspace, but its traced Next package still contains the affected nested PostCSS copy. This packaging change does not resolve that advisory. Do not use these tools on untrusted project/configuration files.

## Reproducible gate and review expiry

Run `npm run security:audit`. It requests the current npm advisory report for the exact lockfile and fails on registry/report errors, new advisories, changed severity, changed affected versions/paths, expired reviews, or obsolete exceptions. It does not run `npm audit fix`, force major dependency overrides, or silently ignore every finding in a package.

`docs/AUDIT-EXCEPTIONS.json` records the five reviewed advisory IDs above, exact installed locations and versions, rationale, and a **2026-11-09** expiry. The current report has five propagated affected package entries (four high, one moderate, zero critical); five leaf advisories are temporarily accepted for the narrowly described build/CLI paths. A passing gate means the report matches this explicit temporary policy, not that the dependency tree has zero known vulnerabilities. Any renewal requires reviewing the current call paths and upstream fixes; do not merely extend the date to make CI green.

The 2026-10-10 run after adding pinned DOM-testing development tools still matched these five reviewed advisories. Unit fixtures exercise new/critical findings, nested dependency copies, expired and stale exceptions, cyclic/incomplete reports, and unavailable registry responses.

## Verification

- Clean `npm ci --ignore-scripts --no-audit` reproduced the lockfile; explicit Prisma generation then passed. Concurrently smoke test passed with patched shell-quote.
- Typecheck: API and web passed, including a clean-install repeat.
- Production build: API and all 12 Next.js routes passed, with 1536 MB heap cap, including a clean-install repeat.
- Tests: eight API tests passed, zero skipped, against a newly initialized isolated PostgreSQL database; frontend TypeScript test passed.
- Image regression coverage: PNG/JPEG/WebP round-trip normalization, unsupported signatures rejected before parsing, direct native SVG load blocked, truncated PNG rejected.
- Integration coverage includes authenticated image upload, signup, ownership, moderation, authorization, origin protection and idempotency.
- No production database was used, and no public deployment was performed by this review.
