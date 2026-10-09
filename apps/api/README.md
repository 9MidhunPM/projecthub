# ProjectHub API
NestJS + Prisma with PostgreSQL. API contract: [API-CONTRACT.md](API-CONTRACT.md).

## Environment
- DATABASE_URL: required PostgreSQL connection string
- WEB_ORIGIN: exact browser origin; default http://localhost:3000, required in production
- PORT: API listen port, default 4000
- UPLOAD_DIR: persistent screenshot storage, default var/uploads
- NODE_ENV: production enables secure cookies
- COOKIE_SECURE=false: local HTTP testing exception, honored only when production WEB_ORIGIN is explicitly http://localhost[:port] or http://127.0.0.1[:port]. Never disable HTTPS for a public deployment.

From the repository root run npm install, npm run db:generate, npm run db:migrate, npm run dev.
Session tokens are generated with cryptographic randomness and stored hashed in PostgreSQL. There is no static signing secret to leak. Sessions last seven days. Passwords are salted scrypt hashes. Login/signup throttling is per source IP. Login also has an email-keyed attempt limit. The safe default does not trust forwarding headers, so a Next.js proxy shares the source-IP bucket across its users. For per-client limits, first put Next behind an ingress that overwrites X-Forwarded-For, restrict direct Next/API access, then set TRUST_PROXY_IPS to the exact ingress/frontend IPs. Next preserves caller-supplied X-Forwarded-For, so trusting its address without sanitizing ingress enables IP spoofing. Use an upstream distributed limiter for multi-instance production deployments.

Seeding is explicit: DEV_SEED=true DEV_SEED_PASSWORD='<choose a development password of at least 12 characters>' npm run db:seed. It is forbidden with NODE_ENV=production. The fictional accounts are student@projecthub.test, faculty@projecthub.test and admin@projecthub.test. Never provision these accounts into a production database. Provision the first production administrator using a reviewed operator database procedure; public signup always creates a student.

## Verification
npm run build -w @projecthub/api
npm run typecheck -w @projecthub/api
DATABASE_URL='postgresql://...' npm run test -w @projecthub/api
The integration test connects to a real PostgreSQL database, creates uniquely named test users, and deletes its own records. Without DATABASE_URL it is explicitly skipped. Use an isolated test database.

## Security boundaries and operations
- Mutating requests must carry an Origin equal to WEB_ORIGIN, including login/signup and image uploads. Same-origin Next.js proxy forwards that browser header.
- Auth cookies are httpOnly and SameSite=Lax. Public API shapes exclude email and password hashes.
- Project owner controls edits/deletes. Faculty/admin may moderate, but cannot approve their own projects or edit someone else's content.
- Uploaded images are decoded, pixel-limited, resized and re-encoded to WebP; client filenames are discarded. Uploaded media remain private until an approved project references them. Only uploader/reviewers can access private uploads.
- Security/audit events persist role changes and moderation decisions. User role changes are checked against the live database on every request.
- Use durable PostgreSQL and UPLOAD_DIR volumes, HTTPS, DB backups, restrictive database credentials and encrypted disks in production. Clean expired sessions, old view events and unreferenced uploads with an operator-reviewed retention job. Email verification, password-reset email delivery, malware scanning, external object storage and distributed rate limiting are future production integrations rather than simulated features.
