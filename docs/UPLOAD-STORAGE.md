# Upload storage accounting

## Limits and guarantees

Every account has two independent limits:

| API environment variable | Default | Unit |
| --- | --- | --- |
| `UPLOAD_MAX_BYTES` | `104857600` | 100 MiB of normalized WebP bytes |
| `UPLOAD_MAX_FILES` | `500` | Stored files plus incomplete reservations |

Both values must be positive decimal integers no larger than `9007199254740991`. Empty values, zero, signs, whitespace, leading zeroes, fractions, and scientific notation fail API startup. Setting either limit to zero does **not** disable enforcement. This feature adds defaults and validation; it does not change an operator's existing configuration. Compose deployments must explicitly forward any chosen overrides into the API service. All API instances sharing a database/storage directory must use the same limits.

The existing input limit remains 5 MiB, and normalization/decoding still runs under the two-upload, per-process concurrency limit. Quotas measure the actual normalized output, not the multipart input size. A file-count limit also bounds tiny-file and metadata accumulation per account.

The reservation transaction locks the account's `User` row, measures all of its Upload rows, and inserts a `PENDING` row with the output byte count. It commits before the filesystem write. This serializes competing uploads across processes; different accounts use different rows. The file is opened exclusively with mode `0600`, written, and closed before changing the row to `READY` and returning its URL. Both states count against both limits. An exact byte/file limit is allowed. PENDING rows are never served or accepted as project screenshots, regardless of requester privilege or existing project references.

Quota checks are conservative. Removing a screenshot reference, deleting a project, or deleting a user does not delete its Upload records or physical files. Upload records deliberately have no cascading owner relation. A user deletion can therefore leave an ownerless record for inspection. Existing accounts already above a new lower limit keep their images but cannot add more.

## Error handling and interruptions

- `409 UPLOAD_QUOTA_EXCEEDED`: this upload would exceed the account's byte or file limit.
- `503 UPLOAD_ACCOUNTING_UNAVAILABLE`: an existing row has an unknown byte size, or accounting storage is temporarily unavailable. Only new uploads are blocked.
- `503 UPLOAD_STORAGE_UNAVAILABLE`: the filesystem write, close, or READY update failed.
- Processing-capacity overload continues to return 503 with `Retry-After: 1`; it is separate from persistent storage limits.

Client errors never expose filesystem paths, database hosts, or raw storage errors. A rejected reservation does not start a file write. If writing fails after exclusive creation, the request tries to remove only that newly created file. A failed exclusive open never permits deleting a pre-existing file. The reservation is released only after `lstat` reports `ENOENT`; other errors, failed cleanup, or a failed database release retain the charge.

If the READY update fails, the request retains both file and reservation. The database may already have committed READY before its acknowledgement was lost, so deleting then could break a valid file. Process crashes can also leave a PENDING reservation with no file, a partial file, or a complete file. These outcomes consume bounded capacity and require inspection; there is no automatic retry, expiry, quota reset, or cleanup job. Repeated application failures can exhaust an account's quota even when no successful URL was returned. Monitor both storage health and incomplete reservations.

## Additive migration and compatibility

The migration adds nullable `Upload.bytes` and `Upload.state`, defaulting existing records to READY. It preserves all filenames, owner IDs, creation timestamps, and project references. Database checks prohibit negative known byte counts and PENDING rows with unknown sizes. No file is inspected, rewritten, or deleted during migration.

`bytes = NULL` means **unknown**, never zero. Legacy READY files remain readable and attachable under their existing access rules. Until a separately authorized measurement/backfill is implemented, any account with an unknown-size row cannot add uploads. There is intentionally no mutating backfill tool in this change. Missing files, symlinks, malformed names, unknown owners, and orphan files need an explicit recovery decision; none are silently treated as empty storage.

Coordinate upgrade of every upload-serving/writing API instance:

1. Back up the database and the corresponding upload volume together. Validate this change on an isolated restored copy first.
2. Stop or drain old API upload writers and readers before applying the additive migration and starting the rebuilt API with its generated Prisma client.
3. Start all API instances on the new version with the same limits and shared storage, then check readiness, image access, and accounting errors.

Do not run mixed old/new upload handlers. Old binaries do not understand PENDING privacy and can create unaccounted READY rows. Similarly, rolling back to the old upload handler while PENDING records exist is unsafe. A rollback/recovery plan must preserve PENDING privacy and account for every retained reservation; it is an operator decision, not an automatic migration step. A new binary also requires the migration before it queries upload records.

## Boundaries and future retention

Account quotas do not cap total installation storage, unlimited new-account creation, historical orphan files, filesystem metadata overhead, or externally added files. Monitor global free space/inodes and apply infrastructure quotas separately. Multiple API instances need the same durable upload storage as well as the same database. Restrict filesystem writers to the service and trusted operators; database/filesystem transactions cannot protect against arbitrary external replacement of paths.

A future backfill should measure regular files on a stable copy first, preserve unknown-size exceptions, and update metadata only after a separate authorization and validation plan. Future cleanup requires an explicit retention/recovery policy, all-status project-reference checks, and protection for active uploads and unsaved editors. A missing project reference alone is not permission to delete an image: files can be reused in multiple projects or held by an editor that has not saved yet.
