const crypto = require('crypto');
const { previewSalesReportImport, commitSalesReportImport } = require('../services/salesReportImport/salesReportImportService');
const importJobStore = require('../services/importJobStore');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

const LOG_PREFIX = '[SALES_REPORT_PREVIEW]';

async function salesReportImportPreview(req, res) {
  const tRequestStart = Date.now();
  console.log(`${LOG_PREFIX} request start`);
  if (!req.file) return failure(res, 'No file uploaded', 400);
  console.log(`${LOG_PREFIX} file received: ${req.file.originalname} (${req.file.buffer.length} bytes)`);

  const result = await previewSalesReportImport(req.file.buffer);

  // Stringify explicitly (once) so serialization time and the exact response
  // byte size are both measurable — res.json() would otherwise do this same
  // work invisibly. Same envelope success() always sends, just measured.
  const tSerializeStart = Date.now();
  const body = JSON.stringify({ success: true, message: 'Preview generated', data: result });
  const tSerializeEnd = Date.now();
  console.log(`${LOG_PREFIX} JSON serialization: ${tSerializeEnd - tSerializeStart} ms (${body.length} bytes)`);
  console.log(`${LOG_PREFIX} total (request start to response ready): ${tSerializeEnd - tRequestStart} ms`);

  res.status(200).type('application/json').send(body);
}

/**
 * Commit is a background job, not a synchronous request/response: a large
 * file's actual DB write can run for minutes, and the client needs to be
 * able to show real elapsed-time/stage progress the whole way through (and
 * survive a page refresh via jobId) rather than holding one HTTP request
 * open with zero feedback until it either resolves or the browser gives up.
 * This endpoint only creates the job and returns its id immediately — the
 * import itself runs after the response is sent; see
 * salesReportImportProgress for how a client observes it.
 */
async function salesReportImport(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const { buffer } = req.file;
  const userId = req.user.id;

  const jobId = crypto.randomUUID();
  importJobStore.createJob(jobId);
  success(res, { jobId }, 'Import started', 202);

  // Fire-and-forget: the request has already been answered above. Runs against
  // the SAME commitSalesReportImport used everywhere else — no business logic
  // duplicated or changed, jobId only adds progress reporting (see
  // salesReportImportService.js).
  commitSalesReportImport(buffer, userId, jobId)
    .then(async (result) => {
      importJobStore.complete(jobId, result);
      await logActivity({ userId, action: 'IMPORT_EXCEL', details: { type: 'SALES_REPORT', ...result } });
    })
    .catch((err) => {
      importJobStore.fail(jobId, err);
    });
}

async function salesReportImportProgress(req, res) {
  const { jobId } = req.params;
  const job = importJobStore.getJob(jobId);
  if (!job) return failure(res, 'Import job not found', 404);

  const now = Date.now();
  const elapsedSeconds = Math.round(((job.completedAt || now) - job.startedAt) / 100) / 10;

  return success(res, {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    statusMessage: job.statusMessage,
    totalRows: job.totalRows,
    elapsedSeconds,
    stages: job.stages,
    error: job.error,
    result: job.result,
    startedAt: new Date(job.startedAt).toISOString(),
    completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : null,
  });
}

module.exports = { salesReportImportPreview, salesReportImport, salesReportImportProgress };
