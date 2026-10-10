-- Content/workflow concurrency token; passive view increments do not change it.
ALTER TABLE "Project" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
