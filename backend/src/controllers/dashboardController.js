const { getStoreProductivity, getCompanyDashboard } = require('../services/dashboardService');
const { success } = require('../utils/apiResponse');

async function companyDashboard(req, res) {
  const data = await getCompanyDashboard(req.user);
  return success(res, data);
}

async function storeDashboard(req, res) {
  const { id } = req.params;
  const { from, to } = req.query;
  const data = await getStoreProductivity({ storeId: id, from, to });
  return success(res, data);
}

module.exports = { companyDashboard, storeDashboard };
