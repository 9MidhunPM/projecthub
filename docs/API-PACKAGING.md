# API image dependency scope

`Dockerfile.api` installs only the `@projecthub/api` workspace from the existing root lockfile:

```sh
npm ci --workspace=@projecthub/api --include-workspace-root=false
```

Both workspace manifests remain available so npm can interpret the unchanged workspace lockfile. The image retains the API's development dependencies deliberately: the same image serves the API, runs the one-off migration service, and supports the explicitly enabled local-development seed. Compose service names, commands, dependency ordering, secret handling, upload ownership, and health checks are unchanged.

## Included and excluded packages

Included:

- Compiled API, source required by the seed, checked-in Prisma schema and migrations
- Generated Prisma Client and its native query engine
- Prisma CLI and its migration engine, TypeScript, and tsx
- sharp and its platform-specific optional native dependencies
- Credential wrapper and readiness probe

Excluded from the API dependency installation:

- Next.js, React, React DOM, and lucide-react
- Tailwind/PostCSS frontend build tooling and DOM-testing packages
- Root-only concurrently development tooling

This is an API-scoped image, not a production-dependencies-only image. `npm run dev` inside this image is not supported because concurrently belongs to the root development workspace. Use the normal full repository installation for development.

## Migration, seed, and operator compatibility

The existing `npm run db:migrate` and documented local `api npm run db:seed` commands retain their dependencies and paths. Seeds remain forbidden in production and require both `DEV_SEED=true` and a supplied development password. No seed is run automatically. See [the local container instructions](../README.md#production-style-local-containers).

The compiled upload-inventory command remains present. Its existing restrictions still apply: an isolated, loopback-only test/restored database, explicit inventory connection variable, and no production mode. Packaging does not authorize production inventory, mutation, or recovery. See [upload storage](UPLOAD-STORAGE.md#read-only-inventory-on-an-isolated-copy).

Do not replace this scoped install with `--omit=dev` without reviewing those workflows. In the current lockfile, Prisma CLI and TypeScript also satisfy optional peer dependencies of `@prisma/client`; their `devOptional` classification means `--omit=dev`, even with `--omit=peer`, does not remove them. It does remove tsx, breaking the seed command. Omitting all optional dependencies also removes sharp's native packages. A smaller dedicated runtime image would require a separately tested runtime/operator split.

## Isolated fixture evidence — 2026-10-10

An isolated Linux x64 fixture used Node **22.23.3**, npm **10.9.9**, the unchanged lockfile, and an offline scoped install. All 170 required installed package tarballs were available in the existing npm cache. The install used `--ignore-scripts --no-audit --no-fund`; matching existing Debian/OpenSSL 3 Prisma query and schema engines were copied into the fixture, followed by explicit Prisma generation and API compilation. This tests the resulting dependency layout, not a clean online lifecycle-script installation.

Measured after generation, using `du -sk node_modules` and `du -sk --apparent-size node_modules`:

| Dependency tree | Allocated size | Apparent size |
| --- | ---: | ---: |
| Existing full-workspace installation | 942,468 KiB (920.4 MiB) | 857,753 KiB (837.6 MiB) |
| Isolated API-only installation | 365,392 KiB (356.8 MiB) | 328,328 KiB (320.6 MiB) |

The fixture reduced allocated dependency storage by **61.2%**. It contains **170 package directories plus one API workspace link**, versus 284 package directories in the full installation. These are local filesystem measurements, not Docker image-layer, compressed-download, or deployment-memory measurements. Installation scripts, platform selection, and filesystem layout can change the figures.

Passed in that fixture:

- Prisma Client 6.19.3 generation and API TypeScript compilation
- 108 API unit tests and 14 real-PostgreSQL integration tests; zero failed or skipped
- Native PNG/JPEG/WebP normalization, metadata/orientation coverage, and unsupported-loader rejection through the existing image tests
- All four checked-in migrations against a newly initialized disposable PostgreSQL cluster; a second migration run reported no pending migrations
- Two explicit development seed runs produced the expected three fictional accounts and eight approved projects
- Production mode, missing seed opt-in, and missing seed password were rejected without changing user/project row counts
- Compiled API readiness, a gallery query, and login using the fictional seeded administrator
- Compiled read-only upload inventory completed against the isolated fixture
- Excluded frontend/root packages could not resolve; required API/tooling packages resolved within the fixture

`NODE_PATH` and Prisma engine overrides were unset for runtime checks. A CommonJS resolution guard rejected modules outside the fixture, except npm's own implementation while running npm commands; 55 process logs recorded no shared-checkout dependency fallback. Parent directories had no `node_modules`. The disposable database cluster and temporary upload directory were removed. The source lockfile was not changed.

Subsequent hosted Docker execution of the scoped image is recorded separately in the [verified application checkpoint](VALIDATION.md#verified-application-checkpoint-2026-10-10). Its in-container probe checks dependency isolation, retained tooling, generated Prisma Client, and native sharp behavior; those runtime results do not turn the fixture measurements above into image-size measurements. This local experiment did not run Docker, deploy software, access production data, change credentials, or validate another CPU architecture.

## Security review remains unchanged

Keep all five existing advisory exceptions and their review expiry. The scoped API image still includes Prisma CLI, `@prisma/config`, and the accepted `deepmerge-ts` finding. Next's affected nested PostCSS copy remains relevant to the frontend/source dependency review even though Next is excluded from the API image. Continue running the full repository audit gate; an API-only audit cannot replace it. See [dependency review](DEPENDENCY-AUDIT.md).

This change reduces the API image's dependency set. It does not establish that the remaining dependencies or application are vulnerability-free.

References: [npm workspace install options](https://docs.npmjs.com/cli/v10/commands/npm-ci/#workspace), [npm v10 omission behavior](https://github.com/npm/cli/blob/v10.9.4/workspaces/arborist/lib/arborist/reify.js), [sharp native installation requirements](https://sharp.pixelplumbing.com/install/), and [Prisma v6 deployment engine compatibility](https://www.prisma.io/docs/orm/v6/prisma-client/deployment/deploy-to-a-different-os).
