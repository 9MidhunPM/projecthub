-- Session issuance filters by user and orders/expires that user's sessions.
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- Workspace and moderation queries filter by owner/status and sort by update time.
CREATE INDEX "Project_ownerId_updatedAt_idx" ON "Project"("ownerId", "updatedAt");
CREATE INDEX "Project_status_updatedAt_idx" ON "Project"("status", "updatedAt");

-- Gallery technology filters and upload visibility checks use array containment.
CREATE INDEX "Project_techStack_idx" ON "Project" USING GIN ("techStack");
CREATE INDEX "Project_screenshots_idx" ON "Project" USING GIN ("screenshots");

-- Composite primary keys start with userId, so project counts and cascading
-- project deletes require reverse-lookup indexes on projectId.
CREATE INDEX "Like_projectId_idx" ON "Like"("projectId");
CREATE INDEX "Bookmark_projectId_idx" ON "Bookmark"("projectId");

-- Admin audit history is bounded and ordered newest first.
CREATE INDEX "Audit_createdAt_idx" ON "Audit"("createdAt");
