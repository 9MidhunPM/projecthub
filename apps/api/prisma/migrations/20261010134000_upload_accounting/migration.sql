-- Preserve existing URLs and ownership records. NULL means unmeasured legacy
-- storage, never zero bytes. No files or historical records are removed.
CREATE TYPE "UploadState" AS ENUM ('PENDING', 'READY');
ALTER TABLE "Upload"
  ADD COLUMN "bytes" BIGINT,
  ADD COLUMN "state" "UploadState" NOT NULL DEFAULT 'READY',
  ADD CONSTRAINT "Upload_bytes_nonnegative" CHECK ("bytes" IS NULL OR "bytes" >= 0),
  ADD CONSTRAINT "Upload_pending_bytes_known" CHECK ("state" <> 'PENDING' OR "bytes" IS NOT NULL);
