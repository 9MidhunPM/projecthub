# Dokploy deployment guide

Preparing this configuration does not itself deploy the app. Deployment to `projecthub.midhunpm.in` through the existing Dokploy installation has been approved separately; this document is configuration guidance, not evidence that a deployment succeeded. New costs, agreements, unrelated services, or expanded access require separate approval.

## Before approval

Review the source, run type checks/unit/integration/browser tests, choose the public audience and privacy policy, select a domain, and approve infrastructure/costs. Remove demo accounts/content from live data. Resolve email verification and account recovery requirements. Define who may grant faculty/admin roles and how the first production administrator will be established; the development seed intentionally refuses production mode.

## After deployment is approved

1. Create a Dokploy project and a Docker Compose service pointed at the approved repository/revision. Use `compose.dokploy.yaml` and repository-root build context. Select **Docker Compose**, not Docker Stack: this recipe builds images from source and relies on Compose dependency conditions. Enable **Isolated Deployments** so Dokploy supplies a project-scoped network for every service; do not manually attach the database to a shared `dokploy-network`. Before deploying, inspect **Preview Compose** and verify the database, migration, API, and web services share the isolated network and only `web` has public routing. Both images depend on the root npm lockfile and both workspace package manifests.
2. The dedicated recipe creates its database credential **inside the server**, using the one-shot `secrets-init` container and Node's cryptographic random generator. No manual password variable is required. Do not configure `POSTGRES_PASSWORD` or `DATABASE_URL` in Dokploy for this recipe: they would conflict with file-based credentials. The bootstrap writes once to the project-scoped `db_credentials` named volume; PostgreSQL consumes `POSTGRES_PASSWORD_FILE`, and the API/migration wrapper constructs its connection URL only within its child process environment. The dedicated recipe fixes `WEB_ORIGIN=https://projecthub.midhunpm.in` and `COOKIE_SECURE=true`. No credential is printed or placed in repository/configuration arguments.
3. Use Dokploy's Compose Domains configuration to route `projecthub.midhunpm.in` to service `web`, port `3000`, with HTTPS and a valid certificate. API and database should not have public domains or host ports. The frontend proxies `/api` internally.
4. Deploy only after approval. The database healthcheck gates the one-off `migrate` service, and successful migrations gate API startup. Examine all build/migration/runtime logs. Set operational health monitoring for `/api/health` through the frontend, and verify database connectivity with a real gallery request.
5. Do not run the development seed in production. Bootstrap the initial admin through a separately approved, audited operator procedure, then use the admin UI for role changes. There is deliberately no public admin-signup route.
6. Verify login/logout, secure HTTP-only cookies, upload/readback, submission/approval, and unauthenticated privacy in the approved staging environment before inviting users.

Dokploy adds the needed domain routing labels to Compose deployments, and domain changes require redeployment. Prefer its documented Domains interface rather than hand-writing guessed Traefik labels. See the official [Compose Domains guide](https://docs.dokploy.com/docs/core/docker-compose/domains) and [Compose example](https://docs.dokploy.com/docs/core/docker-compose/example).

## Persistence and recovery

`postgres_data`, `uploads`, and `db_credentials` are all required. Keep volume identity stable across deployments. Back up PostgreSQL using a consistent database backup method, the upload volume, and the credential volume on a coordinated schedule. Credential backups are secrets: encrypt them and restrict access. Never display or paste their contents into logs, chat, screenshots, or tickets. Encrypt backups, restrict access, and rehearse restores on separate infrastructure. No backup job is automatically installed by this repository.

Before every schema update, review migrations and take a recoverable backup. Roll back application code only if it is compatible with the applied schema; Prisma migrations are not automatically reversible. Do not delete volumes to fix failed startup. Investigate migrate logs and recover deliberately.

## Operational limits

Dockerfiles use Node 22 Debian slim and include build tooling to support migrations; they prioritize a reproducible, inspectable MVP over minimal image size. Container image builds have not been verified unless specifically recorded in the final validation report. Pin image digests and scan images/dependencies as part of a real release process. Configure log retention, process/memory limits, uptime alerts, and shared rate-limit/storage infrastructure before scaling. Existing health JSON is process liveness, not a complete database/readiness check.

The development Compose override exposes PostgreSQL only on loopback and should not be added to the production stack. The dedicated Dokploy recipe publishes no host ports at all. Dokploy's reverse proxy supplies public routing through service `web` port 3000. The original local `compose.yaml` remains unchanged and loopback-bound for local use.

Leave `TRUST_PROXY_IPS` unset until the ingress has been verified to replace untrusted forwarding headers. The Next.js proxy can preserve client-supplied `X-Forwarded-For`; trusting its address alone does not safely establish client identity. Without proxy trust, rate limits group traffic by the proxy IP. Resolve this operational limitation before a real rollout.

## Limited-memory build plan

The existing host was reported to have roughly 4.4 GB available memory. `Dockerfile.web` accepts build-only `NODE_BUILD_OPTIONS` and the dedicated recipe sets `--max-old-space-size=1536`. This caps each Node process's old-generation JavaScript heap, not total build/process/container memory; it is not a guarantee that a build will fit. The runtime image does not inherit the build-only setting.

Build sequentially where Dokploy's existing controls support it; `COMPOSE_PARALLEL_LIMIT=1` is a Compose CLI option to set in the deployment process environment, not inside application containers. Do not run parallel ProjectHub builds or restart existing workloads to free capacity. Inspect available memory and build logs before retrying an out-of-memory failure. If the existing host cannot build safely, stop and seek approval for a separate build host or another plan rather than changing swap, host limits, or existing services. Container execution has not yet been validated by this configuration change.

After initial deployment, keep the same Dokploy Compose resource and volume identity so upgrades retain PostgreSQL and uploaded images. Never remove named volumes to recover a failed build or migration. Domain configuration should be reviewed in Preview Compose before deployment, because Dokploy applies network/routing modifications there. See the official [Isolated Deployments documentation](https://docs.dokploy.com/docs/core/docker-compose/utilities#isolated-deployments).

## Server-local credential bootstrap

This is for the fresh ProjectHub stack; it is not an automatic migration of an existing database with another password. The one-shot initializer runs as root only inside its own container, has a read-only root filesystem, and writes only its Docker-managed credential volume. It mounts the database volume read-only solely to detect an already initialized cluster. It does not change host users, host permissions, security settings, existing services, or credentials for other applications.

A 48-byte cryptographic random value is encoded as 96 hexadecimal characters. Creation is atomic and exclusive; a valid existing file is preserved on every redeploy. The directory is root:1000 with mode 0750, and the file root:1000 with mode 0440. The Node API image's built-in `node` user is UID/GID 1000 and receives a read-only mount. The official PostgreSQL image begins its entrypoint as root, reads the file before dropping privileges, and passes the result internally; it must not be overridden to start directly as a non-root user in this recipe. PostgreSQL host authentication is explicitly SCRAM-SHA-256, with no public database port. The web container does not receive the secret volume.

The initializer refuses to generate a replacement when PostgreSQL's `PG_VERSION` exists but the credential file is missing. Restore the original credential volume together with the database; do not delete database data or regenerate credentials as a recovery shortcut. Automatic rotation is intentionally not implemented. Rotation requires a separate coordinated database/password-file operation and approval. Docker/host administrators retain access to volumes and process environments; this is protection from accidental configuration/log disclosure, not a substitute for protecting the host.

`node --test docker/secret-bootstrap.test.cjs` covers creation, reuse, missing-secret recovery refusal, permissions, child-only URL construction, and conflicting configuration using deterministic in-memory fixtures. Six tests passed. Docker image execution and actual root-to-PostgreSQL privilege-drop behavior still require verification during the approved deployment; no production credential was created by these tests. Official image implementation: [PostgreSQL Docker entrypoint](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh).
