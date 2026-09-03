/**
 * In-memory tracker for long-running import jobs (currently: Sales Report
 * commit) so a client can poll real progress instead of waiting on one long
 * HTTP request with zero feedback. Single-process, in-memory by design —
 * this app runs as one Node process with no queue/worker infrastructure
 * (confirmed: no job-queue library, no Redis, no clustering), and a job's
 * entire lifetime is a few minutes at most, so persisting it to the DB would
 * add real complexity for no real benefit. The tradeoff, stated plainly: a
 * server restart mid-import loses that job's progress record (the DB write
 * itself is unaffected either way, since the DB is the actual source of
 * truth — this store only ever reports on it, never gates it).
 *
 * Stages, in order: parsing -> transforming -> validating -> database_insert
 * -> completed (or failed at any point). `status` is the coarse lifecycle
 * (queued/importing/completed/failed); `stage` is which of the four
 * processing steps is current.
 */
const jobs = new Map();

const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour — plenty for any realistic "did my import finish" check, short enough to not leak memory forever
const STAGE_NAMES = ['parsing', 'transforming', 'validating', 'database_insert'];

function now() {
  return Date.now();
}

/** Drops jobs older than JOB_TTL_MS (by startedAt) — called on every createJob so the map never grows unbounded across a long-running server process. */
function sweepExpiredJobs() {
  const cutoff = now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.startedAt < cutoff) jobs.delete(id);
  }
}

function createJob(id) {
  sweepExpiredJobs();
  const startedAt = now();
  const job = {
    id,
    status: 'importing', // 'importing' | 'completed' | 'failed'
    stage: 'parsing', // 'parsing' | 'transforming' | 'validating' | 'database_insert' | 'completed' | 'failed'
    totalRows: null, // known once parsing finishes
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    // The job starts life already inside the "parsing" stage, so it begins in_progress
    // (with startedAt set) rather than pending — beginStage() only ever closes out a
    // stage that's actually in_progress, so parsing needs a real start time to close
    // against the first time beginStage() moves the job on to "transforming".
    stages: STAGE_NAMES.map((name, i) => ({
      name,
      status: i === 0 ? 'in_progress' : 'pending',
      startedAt: i === 0 ? startedAt : null,
      completedAt: null,
      durationSeconds: null,
    })),
    statusMessage: 'Reading Excel file...',
    // Real sub-stage progress, currently only ever populated during "database_insert" (see
    // setStageProgress/salesReportRepository's chunked upsertRecords) — { processed, total }
    // taken directly from rows actually written and awaited, never estimated. null whenever
    // the current stage has no such per-chunk signal (parsing/transforming/validating are
    // each one un-chunked call — see the stage checklist for those instead).
    stageProgress: null,
    error: null,
    result: null,
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

/** Marks `stage` as started (and the previous stage, if any, as completed) — this is the only thing that ever moves `job.stage`/`job.stages` forward. */
function beginStage(id, stage, statusMessage) {
  const job = jobs.get(id);
  if (!job) return;
  const t = now();

  const currentIndex = STAGE_NAMES.indexOf(job.stage);
  if (currentIndex !== -1 && job.stages[currentIndex].status === 'in_progress') {
    job.stages[currentIndex].status = 'completed';
    job.stages[currentIndex].completedAt = t;
    job.stages[currentIndex].durationSeconds = round2((t - job.stages[currentIndex].startedAt) / 1000);
  }

  const nextIndex = STAGE_NAMES.indexOf(stage);
  if (nextIndex !== -1) {
    job.stages[nextIndex].status = 'in_progress';
    job.stages[nextIndex].startedAt = t;
  }

  job.stage = stage;
  job.statusMessage = statusMessage;
  job.stageProgress = null; // a new stage starts with no progress of its own yet
  job.updatedAt = t;
}

function setTotalRows(id, totalRows) {
  const job = jobs.get(id);
  if (!job) return;
  job.totalRows = totalRows;
  job.updatedAt = now();
}

/** Real, row-counted progress within the CURRENT stage (currently only database_insert reports this — see salesReportRepository.upsertRecords' onBatchComplete). */
function setStageProgress(id, { processed, total }) {
  const job = jobs.get(id);
  if (!job) return;
  job.stageProgress = { processed, total };
  job.updatedAt = now();
}

function complete(id, result) {
  const job = jobs.get(id);
  if (!job) return;
  const t = now();

  const currentIndex = STAGE_NAMES.indexOf(job.stage);
  if (currentIndex !== -1 && job.stages[currentIndex].status === 'in_progress') {
    job.stages[currentIndex].status = 'completed';
    job.stages[currentIndex].completedAt = t;
    job.stages[currentIndex].durationSeconds = round2((t - job.stages[currentIndex].startedAt) / 1000);
  }

  job.status = 'completed';
  job.stage = 'completed';
  job.statusMessage = 'Import completed.';
  job.result = result;
  job.completedAt = t;
  job.updatedAt = t;
}

function fail(id, error) {
  const job = jobs.get(id);
  if (!job) return;
  const t = now();

  const currentIndex = STAGE_NAMES.indexOf(job.stage);
  if (currentIndex !== -1 && job.stages[currentIndex].status === 'in_progress') {
    job.stages[currentIndex].status = 'failed';
    job.stages[currentIndex].completedAt = t;
    job.stages[currentIndex].durationSeconds = round2((t - job.stages[currentIndex].startedAt) / 1000);
  }

  job.status = 'failed';
  job.stage = 'failed';
  job.statusMessage = 'Import failed.';
  job.error = error?.message || String(error);
  job.completedAt = t;
  job.updatedAt = t;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { createJob, getJob, beginStage, setTotalRows, setStageProgress, complete, fail };
