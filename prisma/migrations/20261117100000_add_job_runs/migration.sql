-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "session" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "reason" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_runs" (
    "id" TEXT NOT NULL,
    "jobRunId" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "provider" TEXT,
    "session" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "received" INTEGER NOT NULL DEFAULT 0,
    "persisted" INTEGER NOT NULL DEFAULT 0,
    "expected" INTEGER,
    "httpStatus" INTEGER,
    "error" TEXT,
    "sourceAsOf" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "dataset_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_locks" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_locks_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "job_runs_job_startedAt_idx" ON "job_runs"("job", "startedAt");

-- CreateIndex
CREATE INDEX "job_runs_status_startedAt_idx" ON "job_runs"("status", "startedAt");

-- CreateIndex
CREATE INDEX "job_runs_session_idx" ON "job_runs"("session");

-- CreateIndex
CREATE INDEX "dataset_runs_jobRunId_idx" ON "dataset_runs"("jobRunId");

-- CreateIndex
CREATE INDEX "dataset_runs_dataset_startedAt_idx" ON "dataset_runs"("dataset", "startedAt");

-- CreateIndex
CREATE INDEX "dataset_runs_dataset_session_status_idx" ON "dataset_runs"("dataset", "session", "status");

-- AddForeignKey
ALTER TABLE "dataset_runs" ADD CONSTRAINT "dataset_runs_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "job_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

