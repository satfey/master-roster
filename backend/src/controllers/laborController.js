const { recordActualHours, getStoreLaborSummary } = require('../services/laborService');
const { success } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

async function recordHours(req, res) {
  const { shiftId, actualHours, clockIn, clockOut } = req.body;

  const record = await recordActualHours({
    shiftId,
    actualHours: Number(actualHours),
    clockIn: clockIn ? new Date(clockIn) : null,
    clockOut: clockOut ? new Date(clockOut) : null,
    recordedBy: req.user.id,
  });

  await logActivity({ userId: req.user.id, action: 'RECORD_ACTUAL_HOURS', details: { shiftId, actualHours } });

  return success(
    res,
    record,
    record.isOverPlanned ? 'Warning: actual hours exceed the planned shift hours' : 'Actual hours recorded'
  );
}

async function summary(req, res) {
  const { storeId, from, to } = req.query;
  const data = await getStoreLaborSummary({ storeId, from, to });
  return success(res, data);
}

module.exports = { recordHours, summary };
