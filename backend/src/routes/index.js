const router = require('express').Router();

router.use('/', require('./authRoutes'));
router.use('/forecast', require('./forecastRoutes'));
router.use('/roster', require('./rosterRoutes'));
router.use('/dashboard', require('./dashboardRoutes'));
router.use('/store/master', require('./storeMasterImportRoutes'));
router.use('/store', require('./storeRoutes'));
router.use('/employee', require('./employeeRoutes'));
router.use('/sales/report', require('./salesReportRoutes'));
router.use('/sales/by-hour', require('./salesByHourRoutes'));
router.use('/sales', require('./salesRoutes'));
router.use('/labor', require('./laborRoutes'));
router.use('/', require('./importRoutes')); // /employee/import, /store/import, /import
router.use('/user', require('./userRoutes'));

const calculateRoute = require("./calculate");

router.use(calculateRoute);

module.exports = router;
